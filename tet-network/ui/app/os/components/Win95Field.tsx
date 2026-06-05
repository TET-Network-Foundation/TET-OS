"use client";

import { bevel, surface, cx } from "./tokens";

export type Win95FieldProps = {
  /** Label rendered above the input (Tahoma, inherited from body font). */
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number" | "email";
  /** Validation message shown beneath the input (red). */
  error?: string;
  disabled?: boolean;
  /** Render the input value with the mono stack (useful for hex ids). */
  mono?: boolean;
  maxLength?: number;
  /** Extra classes on the outer wrapper. */
  className?: string;
  /** Extra classes on the `<input>` itself. */
  inputClassName?: string;
};

/**
 * Win95 labelled text field: sunken (inset) input on the light field face,
 * with an optional caption above and an optional error line below.
 */
export default function Win95Field(props: Win95FieldProps) {
  const {
    label,
    value,
    onChange,
    placeholder,
    type = "text",
    error,
    disabled = false,
    mono = false,
    maxLength,
    className,
    inputClassName,
  } = props;

  return (
    <label className={cx("block", className)}>
      {label ? <span className="block text-sm mb-1">{label}</span> : null}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        className={cx(
          bevel.inset,
          surface.field,
          "w-full px-2 py-1 text-sm outline-none",
          mono ? "font-mono" : "",
          disabled ? "opacity-60" : "",
          error ? "border-t-[#8a1f1f] border-l-[#8a1f1f]" : "",
          inputClassName,
        )}
      />
      {error ? <span className="block text-[11px] text-[#8a1f1f] mt-1">{error}</span> : null}
    </label>
  );
}
