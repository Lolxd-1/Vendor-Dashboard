import { createApi } from "@reduxjs/toolkit/query/react";
import { fetchBaseQuery } from "@reduxjs/toolkit/query";
// Same-origin default ("") so the app works behind the Vercel proxy with no env set.
// Local dev uses VITE_API_URL=http://prd.quickverse.in/ from .env.
export const baseurl: string = import.meta.env.VITE_API_URL ?? "";
const api = createApi({
  reducerPath: "api",
  tagTypes: ["VendorSchedule"],
  
  baseQuery: fetchBaseQuery({
    baseUrl: `${baseurl}`,
    prepareHeaders: (headers) => {
      headers.set(
        "Authorization",
        "Basic cXZDYXN0bGVFbnRyeTpjYSR0bGVfUGVybWl0QDAx",
      );
      headers.set("Content-Type", "application/json");
      headers.set("Accept", "application/json");
      headers.set("Request-Origin", "VENDOR");

      return headers;
    },
  }),
  endpoints: (_) => ({}),
});

export default api;
