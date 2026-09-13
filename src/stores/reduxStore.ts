import { configureStore } from "@reduxjs/toolkit";
import api from "../apis/index";

export const reduxStore = configureStore({
  reducer: {
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(api.middleware),
});
