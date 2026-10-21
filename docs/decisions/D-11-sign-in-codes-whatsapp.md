# D-11 (part) — Sign-in codes are sent on WhatsApp through Haswa

|            |                                                                       |
| ---------- | --------------------------------------------------------------------- |
| Decision   | Which channel and provider deliver the 6-digit sign-in codes (OTP)    |
| Status     | **Decided** by the Product Owner, 21 October 2026                     |
| Relates to | D-11 (vendors: WhatsApp BSP), FS §4.9, EC-22 (WhatsApp unavailable)   |
| Scope      | Sign-in codes only. Payment gateway and other D-11 vendors stay open. |

## Decision

- Sign-in codes go to the person's phone number **on WhatsApp**, through the **Haswa**
  WhatsApp API, using a Meta-approved **Authentication** template.
- **WhatsApp-only for now.** There is no SMS or email fallback yet; someone without WhatsApp
  on that number cannot sign in. This is accepted for staff and the pilot.
- The code sender stays behind the `OtpSender` adapter (`apps/api/src/auth/otp-sender.ts`),
  so a fallback or another provider can be added without touching sign-in itself.
- Staging may keep printing codes to its log as a backup for testing; production never does.

## Open — before public launch

- **EC-22 fallback:** the FS asks for SMS/email when WhatsApp is unavailable. Choose an SMS
  provider (India DLT registration has a lead time) or email before opening sign-in to the
  public.

## Waiting on

- Haswa API documentation (endpoint, how the API key is sent), the approved template name and
  language, and the connected sender number. The API key goes only into GitHub secrets.
