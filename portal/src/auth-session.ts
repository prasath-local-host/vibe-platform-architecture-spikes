export type PortalRole = "company-user" | "operator";

export interface PortalSession {
  readonly subject: string;
  readonly displayName: string;
  readonly role: PortalRole;
  readonly companyId?: string;
}

export class MemorySession {
  private current: PortalSession | undefined;

  signIn(session: PortalSession): void {
    this.current = { ...session };
  }

  signOut(): void {
    this.current = undefined;
  }

  value(): PortalSession | undefined {
    return this.current ? { ...this.current } : undefined;
  }
}
