import { createAuthService, type AuthService } from "./authService";
import { CloudFunctionDataService, LocalPreviewDataService, UnconfiguredCloudBaseDataService, type EmployeeDataService } from "./dataService";
import { CloudFunctionAccountService, LocalPreviewAccountService, UnconfiguredAccountService, type AccountService } from "./accountService";
import {
  CloudFunctionQuarterlyReviewService,
  LocalPreviewQuarterlyReviewService,
  UnconfiguredQuarterlyReviewService,
  type QuarterlyFunctionClient,
} from "./quarterlyReviewService";
import type { QuarterlyReviewService } from "../quarterly/types";
import { app } from "./cloudbaseAdapter";
import { localShowcaseEnabled } from "./showcaseMode";

export interface AppServices {
  auth: AuthService;
  data: EmployeeDataService;
  accounts: AccountService;
  quarterly: QuarterlyReviewService;
}

export function createAppServices(): AppServices {
  const auth = createAuthService();
  const data = app
    ? new CloudFunctionDataService()
    : localShowcaseEnabled
      ? new LocalPreviewDataService()
      : new UnconfiguredCloudBaseDataService();
  const accounts = app
    ? new CloudFunctionAccountService()
    : localShowcaseEnabled
      ? new LocalPreviewAccountService()
      : new UnconfiguredAccountService();
  const quarterly = app
    ? new CloudFunctionQuarterlyReviewService(app as unknown as QuarterlyFunctionClient)
    : localShowcaseEnabled
      ? new LocalPreviewQuarterlyReviewService()
      : new UnconfiguredQuarterlyReviewService();
  return { auth, data: data as unknown as EmployeeDataService, accounts, quarterly };
}
