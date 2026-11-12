# Operations checklist

What keeps a TET host alive that no code can. The first public testnet's hosts were lost when the
provider closed the account after a late payment, and their disks went with it. Every line below
is there so that can't happen the same way again.

## The account

- [ ] **In an adult's name.** The account holder is an adult who can sign the provider's terms and
      answer the provider's identity or billing questions.
- [ ] **Two payment methods** on file, both in that adult's name: if one fails or expires, the other
      is charged and nothing is suspended.
- [ ] **The billing email is read every week** by a person, not only filtered: reminders, failed
      charges and suspension notices arrive there first, often days before anything stops.
- [ ] **Account recovery works**: a second login factor that isn't on the host, and a recovery code
      kept offline.
- [ ] **Not every host at one provider**, once there is more than one host.

## Every week

- [ ] **Billing:** read the billing email; check that the last invoice is paid.
- [ ] **Backup off the host:** the host makes a tarball every Sunday (`tet-backup.timer`,
      `scripts/backup-node-data.sh`, in `/var/backups/tet`). Pull the newest one to a machine
      outside the host and outside that provider, and check its SHA-256 (`deploy/demo/README.md`
      §3b). A backup that stays on the host is lost with it.
- [ ] **Restore works:** at least once a month, unpack a pulled tarball into an empty directory and
      start a local node from it (what `tools/node-backup/test_backup_restore.py` does), or run that
      test.
- [ ] **The host answers:** the healthchecks.io check is green; `/status/live` shows a rising height.

## Who to contact

| What happened | Who | How |
|---|---|---|
| A charge failed, the account is suspended or closed | the provider's billing support | the provider's support page, from the account holder's login |
| The host is down but the account is fine | the provider's technical support, after the provider status page | as above |
| A TET name points somewhere wrong | the DNS registrar (Porkbun today) | the registrar's account |
| A security problem in TET | the maintainers, privately | `SECURITY.md` |
| Abuse reports about content on the demo | the operator | abuse@tetnet.org (`deploy/demo/README.md` §10) |

Keep the account holder's name and a phone number for urgent billing questions with the owner,
not in this repository.

## When a host is lost anyway

1. Point every TET name away from the old addresses at once (the provider may give them to someone
   else).
2. Rebuild from the newest pulled backup on a new host (`deploy/demo/README.md`, `TET_NODE_ROLE` as
   before). Blocks after the backup are lost unless another node still has them.
3. Say what happened, plainly, where people look: the site, the README, the devlog.
