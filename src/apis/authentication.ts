import api from "./index";


const authenticationApi = api.injectEndpoints({
  endpoints: (build) => ({
    // Request Otp for a given mobile number
    requestOtp: build.mutation({
      query: (phone: string) => ({
        url: "/quickVerse/v1/requestOtp",  // change vendor otp endpoint url
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
        url: "/quickVerse/v1/login", // change vendor login endpoint url
        method: "POST",
        body: { phone: `${phone}`, otp, verificationId },
      }),
    }),

  
  }),
});

export const { useRequestOtpMutation, useLoginMutation } =
  authenticationApi;
