

export interface OrderItem {
  id: number;
  name: string;
  itemCount: number;
  itemPrice?: number;
}

export interface ShopAddress {
  id: number;
  address: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface ShopCoordinates {
  longitude: number;
  latitude: number;
}

export interface ShopDetails {
  shopId: string;
  name: string;
  logo: string;
  banner: string;
  owner: string;
  phone: string;
  openingTime: string;
  closingTime: string;
  preparationTime: string;
  description: string;
  category: string;
  storeActive: boolean;
  storeEnabled: boolean;
  address: ShopAddress;
  coordinates: ShopCoordinates;
  featured: boolean;
}

export interface DeliveryPartnerDetails {
  id: string;
  name: string;
  mobileNumber: number;
  email: string;
  gender: string;
  address: string;
  profilePicture: string;
  drivingLicence: string;
  rcDocument: string;
  aadharCard: string;
  createdAt: string;
  createdBy: string;
  updatedBy: string;
  updatedAt: string;
  isDeleted: boolean;
  totalOrders: number;
  orderSuccess: number;
  orderFailed: number;
  isOnline: boolean;
  latitude: string;
  longitude: string;
  lastLocationUpdatedAt: string;
  vehicleType: string | null;
  todayOrders: number | null;
  weeklyOrders: number | null;
  monthlyOrders: number | null;
  cashAmount: number | null;
}

export interface Order {
  // Primary Identifiers
  orderId: string;
  campusId: string;
  shopId: number;
  customerId: number;
  orderMasterId?: string;
  deliveryPartnerId?: string;

  // Customer Details (Flat)
  customerName: string;
  customerMobile: number;
  customerAddress: string;

  // Status & Timestamps
  state: string;
  creationTime: string;
  acceptedDate?: string | null;
  readyDate?: string | null;
  preparationTime: number;

  // Items & Pricing
  orderItem: OrderItem[];
  totalItemCount: number;
  productCount: number;
  totalAmount: number;
  invoiceAmount: number;
  amountExcludingDeliveryFee: number; //vendor order amount
  deliveryFee: number;
  platformFee?: number;
  packagingCharge?: number;
  gstAmount?: number;

  // Metadata
  fulfillmentOption: string;
  productImageURLs: string;
  stateLabel: string;
  orderDescription: string;
  orderLink: string;
  paymentMethod: string;
  isSettled: boolean;

  // Nested Details
  shopDetails?: ShopDetails | null;
  deliveryPartnerDetails?: DeliveryPartnerDetails | null;
  assignedPartner?: {
    orderStatus?: string;
    [key: string]: any;
  } | null;
}

export type OrderActionEvent = Order;
export type OrderApiResponse = Order;