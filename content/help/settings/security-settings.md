---
title: Security settings
summary: Turn on two-factor authentication, see and sign out your sessions, and, as the owner, require two-factor, set an idle timeout and choose how long the audit log is kept
category: settings
keywords: [two-factor, 2fa, mfa, multi-factor, authenticator app, totp, google authenticator, microsoft authenticator, sessions, sign out everywhere, idle timeout, inactivity, audit log retention, sso, saml, single sign-on, lost phone]
order: 55
updated: 2026-09-29
---

**Settings → Security** has two parts. **Your account** is yours alone: every member manages their own two-factor authentication and sessions there. **Workspace policy** applies to everyone in the workspace, and only the owner can change it. You can also get here from **Profile → Manage security**.

## Two-factor authentication

Two-factor authentication (2FA) means signing in needs your password **and** a 6-digit code from an authenticator app on your phone or computer, so a stolen password on its own is not enough.

1. Choose **Set up two-factor**.
2. Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy or similar) and scan the QR code. If you cannot scan it, type the key shown under it.
3. Enter the 6-digit code the app shows and choose **Confirm and turn on**.

From then on, every sign-in asks for a code after your password. Codes change every 30 seconds; if one is refused, check your device's clock is set automatically.

> **Tip:** Choose **Add a backup authenticator** and add a second app (a password manager works well). If you lose one device you can still sign in with the other.

To remove an authenticator, choose **Remove** next to it. You cannot remove your last one while your workspace requires two-factor.

### If you lose your authenticator

There are no backup codes. Ask your workspace owner to contact ClientTurn support. Once we have confirmed the request comes from your workspace, we remove your authenticator; you then sign in with your password and set up a new one.

## Active sessions

**Active sessions** lists every browser and device signed in to your account, with when it signed in, when it was last active and whether it passed two-factor.

- **Sign out other sessions** signs out everywhere except the browser you are using.
- **Sign out everywhere** signs out every session, including this one. Use it if you think someone else has your password, then change your password.

## Workspace policy (owner only)

Everyone can see these settings; only the owner can change them. Choose **Save policy** after changing any of them.

- **Require two-factor for all members:** anyone without an authenticator is asked to set one up before they can use ClientTurn. It applies to the whole app, including exports. Set up two-factor on your own account first; the switch stays off until you have.
- **Sign out after inactivity:** after this long without using ClientTurn (15 minutes to 12 hours), a member is signed out on that device and asked to sign in again. **Never** keeps the normal behaviour.
- **Keep audit log for:** how long the audit log is kept. The standard period is 12 months. You can choose 6 months on any plan; Pro allows up to 2 years and Enterprise up to 7 years. Older entries are deleted automatically once a day. Downloading an export first keeps your own copy: see **Audit log export** in [Data Controls settings](/help/settings/data-controls-settings).

## Single sign-on (SSO)

SSO with SAML is planned but not available yet. If your organisation needs it, tell us through [Enterprise](/enterprise) so we can plan it with you.

## Related

- [Team settings](/help/settings/team-settings)
- [Data Controls settings](/help/settings/data-controls-settings)
