import { useMemo, useRef } from "react";
import type { ClipboardEvent, FormEvent, KeyboardEvent } from "react";
import { CustomButton } from "./common";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import * as Alert from "../utils/order-alert";

type OtpModalProps = {
  mobileNumber: string;
  otpDigits: string[];
  onClose: () => void;
  onChangeDigit: (index: number, value: string) => void;
  onSubmit: () => void;
  onResendOtp: () => void;
  isSubmitting?: boolean;
};

const OtpModal = ({
  mobileNumber,
  otpDigits,
  onClose,
  onChangeDigit,
  onSubmit,
  onResendOtp,
  isSubmitting = false,
}: OtpModalProps) => {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const [timeLeft, setTimeLeft] = useState(59);

  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  };

  const isOtpComplete = useMemo(
    () => otpDigits.every((digit) => digit.trim() !== ""),
    [otpDigits],
  );

  const handleDigitChange = (index: number, value: string) => {
    const sanitized = value.replace(/\D/g, "").slice(-1);
    onChangeDigit(index, sanitized);

    if (sanitized && index < otpDigits.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleBackspace = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Backspace" && !otpDigits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 4);

    if (!pasted) {
      return;
    }

    event.preventDefault();

    pasted.split("").forEach((digit, index) => {
      onChangeDigit(index, digit);
    });

    const focusIndex = Math.min(pasted.length, 3);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isOtpComplete) {
      setTimeLeft(0);
      onSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 dark:bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 shadow-lg dark:shadow-sm dark:shadow-black/30">

        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-zinc-100">Verify OTP</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">
              Enter the 4-digit code sent to +91 {mobileNumber}
            </p>
            <div className="mt-4 text-sm font-medium text-red-500">
              Resend OTP in:{formatTime(timeLeft)}
            </div>
          </div>
          <CustomButton
            type="button"
            variant="secondary"
            className="px-2 py-1 text-sm"
            onClick={() => {
              setTimeLeft(0);
              onClose();
            }}
          >
            Close
          </CustomButton>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="flex justify-between gap-2" onPaste={handlePaste}>
            {otpDigits.map((digit, index) => (
              <input
                key={index}
                ref={(element) => {
                  inputRefs.current[index] = element;
                }}
                type="text"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                maxLength={1}
                value={digit}
                onChange={(event) =>
                  handleDigitChange(index, event.target.value)
                }
                onKeyDown={(event) => handleBackspace(index, event)}
                className="h-14 w-14 rounded-md border border-slate-300 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-950 text-center text-xl font-medium text-slate-900 dark:text-zinc-100 outline-none focus:border-[#1e40af] dark:focus:border-zinc-400"
                aria-label={`OTP digit ${index + 1}`}
              />
            ))}
          </div>

          <CustomButton
            type="submit"
            disabled={!isOtpComplete || isSubmitting}
            fullWidth
            className="mt-5"
            // RULE 4 (GUIDE.md §3.2): bind audio unlock to the button's
            // onClick, not the form's onSubmit. Click fires synchronously
            // inside the gesture; submit handlers may yield first.
            onClick={() => { void Alert.arm(); }}
          >
            {isSubmitting ? "Verifying..." : "Verify Otp"}
          </CustomButton>
        </form>

        {/* <CustomButton
          type="button"
          onClick={() => {
            setTimeLeft(59);
            onResendOtp();
          }}
          disabled={timeLeft >0 || isSubmitting}
          variant="secondary"
          fullWidth
          className="mt-2"
        >
          Resend OTP
        </CustomButton> */}
        <CustomButton
          type="button"
          variant="secondary"
          fullWidth
          className={`mt-2 ${timeLeft > 0 ? "opacity-50 cursor-not-allowed" : ""}`} // Make it look disabled when timer is running
          onClick={() => {
            if (timeLeft > 0) {
              toast.error(`Please wait, you can resend OTP in ${timeLeft}s`, {
                id: "resend-wait",
              });
            } else {
              setTimeLeft(59);
              onResendOtp();
            }
          }}
          disabled={isSubmitting} // Only disable for real when the API is loading
        >
          Resend OTP
        </CustomButton>
      </div>
    </div>
  );
};

export default OtpModal;