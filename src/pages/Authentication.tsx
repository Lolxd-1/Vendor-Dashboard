import { useEffect, useState } from "react";
import { useFormik } from "formik";
import * as Yup from "yup";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import OtpModal from "../components/Otpmodal";
import { CustomButton, TextInput } from "../components/common";
import {
  useLoginMutation,
  useRequestOtpMutation,
} from "../apis/authentication";
import { useAuthStore } from "../stores/useAuthStore";
import * as Alert from "../utils/order-alert";
import { useThemeStore } from "../stores/useThemeStore";

const MOBILE_LENGTH = 10;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const Authentication = () => {
  const navigate = useNavigate();
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpDigits, setOtpDigits] = useState(["", "", "", ""]);
  const [verificationId, setVerificationId] = useState("");

  const { isAuthenticated, saveSession } = useAuthStore();
  const { setTheme } = useThemeStore();

  const [requestOtp, { isLoading: isRequestingOtp }] = useRequestOtpMutation();
  const [login, { isLoading: isLoggingIn }] = useLoginMutation();

  // Login page defaults to light theme
  useEffect(() => {
    setTheme("light");
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/vendor/dashboard", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const formik = useFormik({
    initialValues: {
      mobileNumber: "",
    },
    validationSchema: Yup.object({
      mobileNumber: Yup.string()
        .required("Mobile number is required")
        .matches(
          INDIAN_MOBILE_REGEX,
          "Enter a valid 10-digit Indian mobile number",
        ),
    }),
    onSubmit: async (values) => {
      try {
        const response = await requestOtp(values.mobileNumber).unwrap();

        console.log("OTP Response:", response);

        setVerificationId(response.response?.verificationId ?? "");

        setOtpDigits(["", "", "", ""]);
        setShowOtpModal(true);
        toast.success("OTP sent via SMS");
      } catch (error: any) {
        const errorMessage = error?.data?.error?.message || "Failed to send OTP. Please try again.";

        toast.error(errorMessage, {
          id: "otp-error"
        });
      }
    },
  });

  const handleChangeOtpDigit = (index: number, value: string) => {
    setOtpDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleVerifyOtp = async () => {
    // RULE 1 (GUIDE.md §3.2): arm() FIRST, synchronously, before any await.
    // This call is still inside the Verify-button gesture, so the browser
    // grants sticky activation and audio stays unlocked for the whole shift.
    const resuming = Alert.arm();
    // Ask for notification permission in the same gesture flow (§3.9).
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
    try {
      if (!verificationId) {
        toast.error("Please request OTP again");
        return;
      }

      const otp = otpDigits.join("");

      const response = await login({
        phone: formik.values.mobileNumber,
        otp,
        verificationId,
      }).unwrap();

      console.log("Otp Verification Response : ", response);

      saveSession(response.jwt, response.shopId, response.phone);

      setShowOtpModal(false);
      toast.success("Login successful ✅");
      // Shift starts here: keep the screen awake + confirm audio is armed.
      void Alert.holdScreenAwake();
      const armed = await resuming;
      if (!armed) {
        console.warn("[audio] arm failed at login — rearm net will retry on next click");
      }
      navigate("/vendor/dashboard", { replace: true });
    } catch (error: any) {
      const errorMessage = error?.data?.error?.message || "Invalid OTP";
      toast.error(errorMessage, {
        id: "otp-error"
      });
    }
  };

  const handleResendOtp = () => {
    void formik.submitForm();
  };

  return (
    <main className="min-h-screen bg-[#F1F5F9] dark:bg-zinc-950 px-4 py-6">

      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-3xl items-center justify-center">
        <section className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-lg dark:shadow-sm dark:shadow-black/30">
          <h1 className="mb-6 text-center text-3xl font-semibold text-slate-900 dark:text-zinc-100">
            QuickVerse
          </h1>

          <form onSubmit={formik.handleSubmit} className="space-y-3">
            <TextInput
              id="mobileNumber"
              label="Mobile Number"
              name="mobileNumber"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter 10-digit mobile number"
              value={formik.values.mobileNumber}
              onBlur={formik.handleBlur}
              onChange={(event) => {
                const nextValue = event.target.value
                  .replace(/\D/g, "")
                  .slice(0, MOBILE_LENGTH);
                void formik.setFieldValue("mobileNumber", nextValue);
              }}
              error={
                formik.touched.mobileNumber && formik.errors.mobileNumber
                  ? formik.errors.mobileNumber
                  : ""
              }
            />

            <CustomButton
              type="submit"
              disabled={isRequestingOtp}
              fullWidth
              // Arm attempt on the Send-OTP click too (valid gesture).
              // Harmless if it fails — the Verify click arms for real.
              onClick={() => { void Alert.arm(); }}
            >
              {isRequestingOtp ? "Sending..." : "Send Otp"}
            </CustomButton>
          </form>

          <p className="mt-3 text-sm text-slate-500 dark:text-zinc-400">
            We will send otp though sms
          </p>
        </section>

      </div>


      {showOtpModal ? (
        <OtpModal
          mobileNumber={formik.values.mobileNumber}
          otpDigits={otpDigits}
          onClose={() => setShowOtpModal(false)}
          onChangeDigit={handleChangeOtpDigit}
          onSubmit={handleVerifyOtp}
          onResendOtp={handleResendOtp}

          isSubmitting={isLoggingIn}
        />
      ) : null}
    </main>
  );
};

export default Authentication;