use anchor_lang::prelude::*;
use anchor_lang::system_program;
use std::io::Write as _;
use std::str::FromStr;

declare_id!("8fRpiwwjpZPZiiNePhistCfHA2ctCLaxJMSWZRP4C6Bx");

#[program]
pub mod nexus_onchain {
    use super::*;
    use anchor_lang::Discriminator;

    pub fn register_worker(ctx: Context<RegisterWorker>, stake_amount: u64) -> Result<()> {
        require!(stake_amount > 0, NexusError::InvalidStakeAmount);

        // Ensure the worker record PDA exists (idempotent register).
        if ctx.accounts.worker_record.lamports() == 0 {
            let rent_lamports = Rent::get()?.minimum_balance(8 + WorkerRecord::INIT_SPACE);
            let (rec_pda, rec_bump) = Pubkey::find_program_address(
                &[b"record", ctx.accounts.worker.key().as_ref()],
                ctx.program_id,
            );
            require_keys_eq!(rec_pda, ctx.accounts.worker_record.key(), NexusError::InvalidRecordPda);

            let ix = system_program::CreateAccount {
                from: ctx.accounts.worker.to_account_info(),
                to: ctx.accounts.worker_record.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
            let create_res = system_program::create_account(
                cpi_ctx.with_signer(&[&[
                    b"record",
                    ctx.accounts.worker.key().as_ref(),
                    &[rec_bump],
                ]]),
                rent_lamports,
                (8 + WorkerRecord::INIT_SPACE) as u64,
                ctx.program_id,
            );
            if create_res.is_err() {
                // Best-effort; if it already exists we'll just overwrite below.
            }
        }

        // Ensure the vault PDA exists even on fresh ledgers.
        // Anchor's `init_if_needed` currently fails to compile in this environment due to
        // missing proc-macro helper crates, so we do the explicit SystemProgram create.
        if ctx.accounts.vault.lamports() == 0 {
            let rent_lamports = Rent::get()?.minimum_balance(0);
            let (vault_pda, vault_bump) = Pubkey::find_program_address(
                &[b"vault", ctx.accounts.worker.key().as_ref()],
                ctx.program_id,
            );
            require_keys_eq!(vault_pda, ctx.accounts.vault.key(), NexusError::InvalidVaultPda);

            // If the account exists but is drained (0 lamports), `create_account` can fail with
            // "account already in use". In that case, it's still safe to continue: the transfer
            // below will fund it.
            if ctx.accounts.vault.owner != &system_program::ID {
                return err!(NexusError::InvalidVaultOwner);
            }

            let ix = system_program::CreateAccount {
                from: ctx.accounts.worker.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
            let create_res = system_program::create_account(
                cpi_ctx.with_signer(&[&[
                    b"vault",
                    ctx.accounts.worker.key().as_ref(),
                    &[vault_bump],
                ]]),
                rent_lamports,
                0,
                &system_program::ID,
            );
            if create_res.is_err() {
                // Best-effort initialization; we'll fund via transfer below.
            }
        }

        // Transfer SOL from worker (signer) into the program vault PDA.
        let ix = system_program::Transfer {
            from: ctx.accounts.worker.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
        system_program::transfer(cpi_ctx, stake_amount)?;

        // Initialize / write worker record data (discriminator + borsh struct).
        {
            let mut data = ctx.accounts.worker_record.try_borrow_mut_data()?;
            let mut cur = std::io::Cursor::new(&mut data[..]);
            cur.write_all(&WorkerRecord::DISCRIMINATOR)?;
            let rec = WorkerRecord {
                pubkey: ctx.accounts.worker.key(),
                stake_amount,
                is_active: true,
            };
            rec.serialize(&mut cur)?;
        }

        Ok(())
    }

    pub fn slash_worker(ctx: Context<SlashWorker>) -> Result<()> {
        // Phase 3.6: admin-only slashing (dev: founder wallet).
        // NOTE: This is a temporary centralized gate until we wire proof-based authorization.
        const ADMIN_PUBKEY_B58: &str = "H78ZgCD1qVcdyxThrM7JiNdvW2QzoY18yoz6y2G9VxGV";
        let admin_pk = Pubkey::from_str(ADMIN_PUBKEY_B58).map_err(|_| error!(NexusError::InvalidAdmin))?;
        require_keys_eq!(ctx.accounts.admin.key(), admin_pk, NexusError::UnauthorizedAdmin);

        // Deactivate worker.
        let rec = &mut ctx.accounts.worker_record;
        rec.is_active = false;

        // Drain the entire vault balance to treasury.
        // This is robust even if the worker called `register_worker` multiple times.
        let vault_lamports = ctx.accounts.vault.to_account_info().lamports();
        if vault_lamports > 0 {
            let (vault_pda, vault_bump) = Pubkey::find_program_address(
                &[b"vault", ctx.accounts.worker.key().as_ref()],
                ctx.program_id,
            );
            require_keys_eq!(vault_pda, ctx.accounts.vault.key(), NexusError::InvalidVaultPda);

            let ix = system_program::Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
            };
            let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), ix);
            system_program::transfer(
                cpi_ctx.with_signer(&[&[
                    b"vault",
                    ctx.accounts.worker.key().as_ref(),
                    &[vault_bump],
                ]]),
                vault_lamports,
            )?;
        }

        // Clear recorded stake.
        rec.stake_amount = 0;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterWorker<'info> {
    #[account(mut)]
    pub worker: Signer<'info>,

    /// Worker record PDA. Created on-demand to make `register_worker` idempotent.
    #[account(
        mut,
        seeds = [b"record", worker.key().as_ref()],
        bump
    )]
    pub worker_record: UncheckedAccount<'info>,

    /// PDA vault that holds SOL staked by workers.
    #[account(
        mut,
        seeds = [b"vault", worker.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashWorker<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: worker identity (used for PDA derivations)
    pub worker: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"record", worker.key().as_ref()],
        bump
    )]
    pub worker_record: Account<'info, WorkerRecord>,

    /// PDA vault that holds SOL staked by workers.
    #[account(
        mut,
        seeds = [b"vault", worker.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: Treasury account that receives slashed SOL
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct WorkerRecord {
    pub pubkey: Pubkey,
    pub stake_amount: u64,
    pub is_active: bool,
}

impl WorkerRecord {
    pub const INIT_SPACE: usize = 32 + 8 + 1;
}

#[error_code]
pub enum NexusError {
    #[msg("stake_amount must be > 0")]
    InvalidStakeAmount,
    #[msg("worker record PDA mismatch")]
    InvalidRecordPda,
    #[msg("vault PDA mismatch")]
    InvalidVaultPda,
    #[msg("vault owner must be system program")]
    InvalidVaultOwner,
    #[msg("invalid admin pubkey constant")]
    InvalidAdmin,
    #[msg("unauthorized admin")]
    UnauthorizedAdmin,
}

