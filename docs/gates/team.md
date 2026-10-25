# Inviting teammates

Built 2026-10-24 (`api/internal/team`, migration 52, `web/app/invite`, `web/components/team-settings.tsx`).

- **Invitation.** An admin names an address and a role (admin, member, viewer). Nothing secret is stored: the link is signed (HMAC) and rebuilt from the invitation's id whenever it is needed. It expires after 7 days; resending extends it. One open invitation per address per workspace; at most 50 waiting; at most 200 people in a workspace.
- **Joining.** The signed-in person's address must be the invited one and must be **confirmed** by the sign-in service (an unconfirmed address is only a claim). Anyone else sees what the link offers but cannot join, and is told it was meant for another address. A used, cancelled or expired link says so. An existing member keeps their role.
- **Roles and removal.** Admins change roles and remove people; anyone can leave. A workspace always keeps one admin (the admin rows are locked while the count is checked, so two changes cannot both pass). Removing someone unassigns their conversations; what they wrote stays.
- **Email.** The worker sends fixed wording (who invited you, to which workspace, as what, a link, 7 days, ignore if unexpected) with an idempotency key per send; revoked, used or expired invitations send nothing; without a provider the job waits and the admin copies the link.
- **Tested.** Invalid input; strangers; forged, altered and empty links; another person, an unconfirmed address and no address; joining, second use; member and viewer powers; promote, demote and the last admin; leaving; revoke, re-invite, expiry and resend; another workspace's admin; the email's content and its refusal to send for dead invitations; the generated role and anonymous sweeps over the new routes; a browser test of the whole flow (admin invites, a different person is refused, the right person signs up and joins, role change, removal) at desktop and phone width with axe.
- **Not tested.** Real email delivery.
