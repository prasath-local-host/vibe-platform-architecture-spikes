export interface IngressRoute {
  readonly companyId: string;
  readonly applicationId: string;
  readonly releaseId: string;
  readonly stablePath: string;
  readonly upstreamUrl: string;
  readonly activatedAt: string;
}

export interface ActivateIngressCommand {
  readonly companyId: string;
  readonly applicationId: string;
  readonly releaseId: string;
  readonly upstreamUrl: string;
  readonly activatedAt: string;
}

export interface IngressRouter {
  activate(command: ActivateIngressCommand): Promise<{ readonly route: IngressRoute; readonly previous?: IngressRoute }>;
  current(companyId: string, applicationId: string): Promise<IngressRoute | undefined>;
  list(): Promise<readonly IngressRoute[]>;
}
