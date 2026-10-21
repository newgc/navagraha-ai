# D-11 (part) — Sign-in codes are sent on WhatsApp through Hashwa

|            |                                                                       |
| ---------- | --------------------------------------------------------------------- |
| Decision   | Which channel and provider deliver the 6-digit sign-in codes (OTP)    |
| Status     | **Decided** by the Product Owner, 21 October 2026                     |
| Relates to | D-11 (vendors: WhatsApp BSP), FS §4.9, EC-22 (WhatsApp unavailable)   |
| Scope      | Sign-in codes only. Payment gateway and other D-11 vendors stay open. |

## Decision

- Sign-in codes go to the person's phone number **on WhatsApp**, through the **Hashwa** API
  (`POST https://eco.hashwa.in/api/send/whatsapp`, API doc version 10.07.25): a text message
  sent from the WhatsApp account linked in Hashwa. No Meta template is involved.
- **We generate and check the codes ourselves** (HMAC-hashed, 5-minute life, 5 attempts,
  audited). Hashwa's own `/send/otp` + `/get/otp` would move checking to the provider; we do
  not use them, so a provider change never touches sign-in.
- **WhatsApp-only for now.** There is no SMS or email fallback yet; someone without WhatsApp
  on that number cannot sign in. This is accepted for staff and the pilot.
- The code sender stays behind the `OtpSender` adapter (`apps/api/src/auth/otp-sender.ts`),
  so a fallback or another provider can be added without touching sign-in itself.
- Staging may keep printing codes to its log as a backup for testing; production never does.

## Open — before public launch

- **EC-22 fallback:** the FS asks for SMS/email when WhatsApp is unavailable. Choose an SMS
  provider (India DLT registration has a lead time) or email before opening sign-in to the
  public.

## Risk to know

Hashwa sends from an ordinary linked WhatsApp account, not the official WhatsApp Business
(Cloud) API. WhatsApp can restrict or ban numbers that send automated messages. Use a
**dedicated number** for sign-in codes (not a personal or InstaLeads number), and if it is
ever blocked, sign-in stops until another account is linked. Moving to an official WhatsApp
Business API provider later only means another `OtpSender`.

## Settings

GitHub `staging` environment: secret `WHATSAPP_API_SECRET` (Hashwa → Tools → API Keys, with
the `wa_send` permission) and `WHATSAPP_ACCOUNT` (the linked account's unique ID). With both
set, the deploy switches `OTP_SENDER` to `whatsapp`; staging also keeps a copy of each code
in its log for the "Staging sign-in codes" button. Production refuses any sender but WhatsApp.
