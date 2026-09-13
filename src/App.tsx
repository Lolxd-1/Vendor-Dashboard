
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {Toaster , toast } from 'react-hot-toast';
import Authentication from './pages/Authentication';
import Layout from './Layout/Dashboardlayout'; 
import Dashboard from './pages/Dashboard';
import ProtectedRoute from './components/common/ProtectedRoute';
import OrderHistory from './pages/OrderHistory';
import StoreStatusPage from './pages/StoreSchedule'


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
          <Route path="order-history" element={<OrderHistory />} />
          <Route path="store-status" element={<StoreStatusPage />} />

        </Route>
        </Route>
        
        <Route path="*" element={<Navigate to="/" replace />} />
       
      </Routes>
    </BrowserRouter>
    
  );
};

export default App;