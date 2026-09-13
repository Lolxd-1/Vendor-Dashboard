import type { InputHTMLAttributes } from "react";

type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label?: string;
  error?: string;
};

const TextInput = ({
  id,
  label,
  error,
  className = "",
  ...props
}: TextInputProps) => {
  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-zinc-300">
          {label}
        </label>
      ) : null}
      <input
        id={id}
        className={[
          "w-full rounded-md border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1e40af] dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-400",
          error ? "border-red-500 focus:border-red-400" : "",
          className,
        ].join(" ")}
        {...props}
      />
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
    </div>
  );
};

export default TextInput;
