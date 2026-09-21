
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {Toaster , toast } from 'react-hot-toast';
import Authentication from './pages/Authentication';
import Layout from './Layout/Dashboardlayout';
import Dashboard from './pages/Dashboard';
import ProtectedRoute from './components/common/ProtectedRoute';

// Non-dashboard routes are code-split: the dashboard is the landing surface on a shop
// counter and must never flash a spinner, so only these two are lazy.
const OrderHistory = lazy(() => import('./pages/OrderHistory'));
const StoreStatusPage = lazy(() => import('./pages/StoreSchedule'));

const RouteFallback = () => (
  <div className="flex items-center justify-center h-full p-8 text-sm text-slate-400 dark:text-zinc-500">
    Loading…
  </div>
);

const App = () => {
  (window as any).toast = toast;
  return (
    <BrowserRouter>
     <Toaster position="top-center" reverseOrder={false} />

     
      <Routes>
         <Route path="/" element={<Authentication />} />

         <Route element={<ProtectedRoute />}>
        
        <Route path="/vendor" element={<Layout />}>
          <Route path="dashboard" element={<Dashboard />} />
          <Route
            path="order-history"
            element={
              <Suspense fallback={<RouteFallback />}>
                <OrderHistory />
              </Suspense>
            }
          />
          <Route
            path="store-status"
            element={
              <Suspense fallback={<RouteFallback />}>
                <StoreStatusPage />
              </Suspense>
            }
          />

        </Route>
        </Route>
        
        <Route path="*" element={<Navigate to="/" replace />} />
       
      </Routes>
    </BrowserRouter>
    
  );
};

export default App;