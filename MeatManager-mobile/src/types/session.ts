export type MobileLicense = {
  clientLicenseId?: string | number;
  licenseId?: string | number;
  commercialName?: string;
  internalCode?: string;
  category?: string;
  billingScope?: string;
  assignedUserId?: string | number | null;
  assignedBranchId?: string | number | null;
  appliesToWebapp?: boolean;
  featureFlags?: string[] | Record<string, boolean> | string | null;
};

export type MobileAccessProfile = {
  id: number | string;
  uid?: string | null;
  firebaseUid?: string | null;
  email?: string | null;
  username: string;
  role: 'admin' | 'employee';
  isOwnerFallback?: boolean;
  active: number;
  perms: string[];
  clientId?: number | string;
  branchId?: number | string | null;
  clientStatus?: string;
  logisticsEnabled?: boolean;
  tenantHasDeliveryLicense?: boolean;
  licenses: MobileLicense[];
};

export type MobileAppMode = 'admin' | 'driver' | 'restricted';
