import type { SelectHTMLAttributes } from "react";

type SelectOption = {
  label: string;
  value: string;
};

type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label?: string;
  options: SelectOption[];
};

const SelectInput = ({
  id,
  label,
  options,
  className = "",
  ...props
}: SelectInputProps) => {
  return (
    <div className="space-y-1">
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700 dark:text-zinc-300">
          {label}
        </label>
      ) : null}
      <select
        id={id}
        className={[
          "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#1e40af] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500",
          className,
        ].join(" ")}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SelectInput;
