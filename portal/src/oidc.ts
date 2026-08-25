import {
  InMemoryWebStorage,
  UserManager,
  WebStorageStateStore,
  type User,
} from "oidc-client-ts";

const authority = import.meta.env.VITE_OIDC_AUTHORITY ?? "http://localhost:8081/realms/vibe";
const clientId = import.meta.env.VITE_OIDC_CLIENT_ID ?? "vibe-control-plane";
const redirectUri = `${window.location.origin}/portal/`;
const memoryUserStore = new WebStorageStateStore({
  prefix: "vcp.oidc.user.",
  store: new InMemoryWebStorage(),
});

const manager = new UserManager({
  authority,
  client_id: clientId,
  redirect_uri: redirectUri,
  post_logout_redirect_uri: redirectUri,
  response_type: "code",
  scope: "openid profile email",
  loadUserInfo: false,
  automaticSilentRenew: false,
  userStore: memoryUserStore,
  // Only the short-lived PKCE verifier and OAuth state cross the full-page redirect.
  // The user and access token use memoryUserStore and never enter browser storage.
  stateStore: new WebStorageStateStore({
    prefix: "vcp.oidc.state.",
    store: window.sessionStorage,
  }),
});

export interface OidcIdentity {
  readonly subject: string;
  readonly displayName: string;
  readonly accessToken: string;
}

function identity(user: User): OidcIdentity {
  return {
    subject: user.profile.sub,
    displayName: user.profile.name ?? user.profile.preferred_username ?? user.profile.sub,
    accessToken: user.access_token,
  };
}

export async function completeOidcSignIn(): Promise<OidcIdentity | undefined> {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.has("code") || parameters.has("error")) {
    const user = await manager.signinRedirectCallback();
    window.history.replaceState({}, document.title, redirectUri);
    return identity(user);
  }
  const user = await manager.getUser();
  return user && !user.expired ? identity(user) : undefined;
}

export async function beginOidcSignIn(): Promise<void> {
  await manager.signinRedirect();
}

export async function endOidcSession(): Promise<void> {
  await manager.signoutRedirect();
}
