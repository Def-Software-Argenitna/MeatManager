export type MobileLicense = {
  clientLicenseId?: string | number;
  licenseId?: string | number;
  commercialName?: string;
  internalCode?: string;
  category?: string;
  billingScope?: string;
  appliesToWebapp?: boolean;
  featureFlags?: string[] | Record<string, boolean> | string | null;
};

export type MobileAccessProfile = {
  id: number | string;
  uid?: string | null;
  email?: string | null;
  username: string;
  role: 'admin' | 'employee';
  active: number;
  perms: string[];
  clientId?: number | string;
  clientStatus?: string;
  licenses: MobileLicense[];
};

export type MobileAppMode = 'admin' | 'driver' | 'restricted';
