import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../../stores/useAuthStore"

const ProtectedRoute = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
