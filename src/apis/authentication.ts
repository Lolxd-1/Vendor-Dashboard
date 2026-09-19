import api from "./index";


const authenticationApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Request Otp for a given mobile number.
    // Overridable via VITE_REQUEST_OTP_URL (backend contract may move off v1).
    requestOtp: build.mutation({
      query: (phone: string) => ({
        url: import.meta.env.VITE_REQUEST_OTP_URL || "/quickVerse/v1/requestOtp",
        method: "POST",
        body: { phone },
      }),
    }),

    // Login using mobile number and otp
    login: build.mutation({
      query: ({
        phone,
        otp,
        verificationId,
      }: {
        phone: string;
        otp: string;
        verificationId: string;
      }) => ({
        url: import.meta.env.VITE_LOGIN_URL || "/quickVerse/v1/login",
        method: "POST",
        body: { phone: `${phone}`, otp, verificationId },
      }),
    }),

  
  }),
});

export const { useRequestOtpMutation, useLoginMutation } =
  authenticationApi;
