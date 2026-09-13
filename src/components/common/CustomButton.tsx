import type { ButtonHTMLAttributes, ReactNode } from "react";

type CustomButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
};

const CustomButton = ({
  children,
  variant = "primary",
  fullWidth = false,
  className = "",
  ...props
}: CustomButtonProps) => {
  const baseStyles =
    "rounded-md px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

  const variantStyles =
    variant === "primary"
      ? "bg-[#1e40af] text-white hover:bg-[#1e3a8a] dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      : "border border-slate-300 bg-transparent text-slate-700 hover:bg-slate-50 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-200 dark:hover:bg-zinc-800";

  const widthStyles = fullWidth ? "w-full" : "";

  return (
    <button
      className={[baseStyles, variantStyles, widthStyles, className].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
};

export default CustomButton;
