# Alba — Feature Inventory & User Stories

> Generated: 2026-03-18
> Purpose: Comprehensive QA checklist for multi-device testing

---

## Table of Contents

1. [Start Screen (Login)](#1-start-screen)
2. [Sign Up Screen](#2-sign-up-screen)
3. [Feed Screen](#3-feed-screen)
4. [Community Screen](#4-community-screen)
5. [Chat List Screen](#5-chat-list-screen)
6. [Single Chat Screen (DMs)](#6-single-chat-screen)
7. [Group Chat Screen](#7-group-chat-screen)
8. [Group Info Screen](#8-group-info-screen)
9. [Profile Screen](#9-profile-screen)
10. [Create Post Screen](#10-create-post-screen)
11. [Single Post Screen](#11-single-post-screen)
12. [Saved Posts Screen](#12-saved-posts-screen)
13. [Feed Settings Screen](#13-feed-settings-screen)
14. [Community Settings Screen](#14-community-settings-screen)
15. [Event Settings Screen](#15-event-settings-screen)
16. [Past Events Screen](#16-past-events-screen)
17. [My Tickets Screen](#17-my-tickets-screen)
18. [Ad Publisher Screen](#18-ad-publisher-screen)
19. [Use Time Screen](#19-use-time-screen)
20. [Pre-Face Recognition Screen](#20-pre-face-recognition-screen)
21. [Face Recognition Screen](#21-face-recognition-screen)
22. [Saved Videos Screen](#22-saved-videos-screen)
23. [Single Feed Video Screen](#23-single-feed-video-screen)
- [Developer Appendix](#developer-appendix)

--- IOS ✅ ANDROID ✅

## 1. Start Screen

*Authentication entry point for returning users.*

- As a user, I should be able to log in with my email/username and password.✅✅
- As a user, I should be able to log in with my Google account via one-tap OAuth.✅✅
- As a user, I should be able to navigate to the Sign Up screen if I don't have an account.✅✅
- As a user, I should be able to request a password reset by entering my email address.✅⚠️
- As a user, I should receive a confirmation message after requesting a password reset ("Check your inbox").✅⚠️
- As a user, I should see clear error feedback when I enter incorrect credentials.✅✅
- As a user, I should see the interface adapt to my device's dark or light mode.✅✅
- As a user logging in from a device I have never used before, I should be asked to enter a 6-digit code sent to my email before being allowed in.
- As a user facing the new-device check, I should be able to enter my 6-digit code and tap "Verify" to proceed.
- As a user facing the new-device check, I should be able to request a new code if mine expired or was not received.
- As a user facing the new-device check, I should be able to cancel and return to the login form.

---

## 2. Sign Up Screen

*Account creation for new users.*


2.1 - Anti-Bot Behavior
- As a new user, after completing the form and tapping "Proceed", I should receive a 6-digit verification code by email.
- As a new user, I should see the form fields become read-only and a numeric code input appear after tapping "Proceed".
- As a new user, I should be able to enter my 6-digit code and tap "Sign Up" to complete registration.
- As a new user, I should see a clear error if the code I entered is wrong or has expired.
- As a new user, I should be able to request a new verification code if mine expired or was not delivered.
- As a new user, I should be able to go back to editing my details if I made a mistake before completing verification.
- As a new user whose device has been banned for a Terms of Service violation, I should be prevented from creating a new account and shown a clear explanation.
- As a new user trying to sign up with a disposable or temporary email address, I should be blocked and told to use a permanent email.
- As a new user on a device that already has 2 registered accounts, I should be blocked from creating another account with a clear explanation.
- As a new user signing up from a network that already has 2 registered accounts, I should be blocked from creating another account with a clear explanation.
- As a user facing the new-device check, I should be able to cancel and return to the login form.
- As a suspended user, I should see a full-screen modal on login explaining the suspension duration, the reason, and a link to the Terms of Service; I should not be able to access the app until the ban expires.
- As a suspended user whose ban has expired, I should be able to tap "Check again" in the suspension modal to re-verify my status and regain access.
- As a permanently terminated user, I should see a non-dismissable full-screen modal informing me of the permanent termination and linking to the Terms of Service.


---

## 3. Feed Screen

- As a user, I should see only videos within a configurable distance radius if I have that filter enabled.⚠️⚠️
- As a user, I should see videos matching my selected category preferences (music, food, sports, etc.).⚠️⚠️
- As a user, I should be able to describe what I want to see in a free-text field and have the feed adapt using semantic search.⚠️⚠️
- As a user, I should be able to tap a creator's username text to navigate to their profile.
- As a user, when I navigate away from the Feed and return to it, the video I was watching should resume playing normally without going black or freezing.❌❌

---

## 4. Community Screen

*Location-based map of nearby posts.*


- As a user, I should be able to filter posts by distance radius and toggle between kilometers and miles.❌❌

- As a user using a VPN, I should be blocked from using location-based features to preserve data integrity.⚠️⚠️
- As a user, I should see my current city name displayed on screen.
- As a user who has denied location permission, I should see no posts and instead see a message explaining why location is needed, with a button to open device Settings and grant access; if my OS blocks deep-linking to Settings, I should see step-by-step manual instructions specific to my platform (iOS or Android).

---

## 5. Chat List Screen

*Inbox for all direct messages and group chats.*

- As a user, I should be able to mute a conversation from the context menu.⚠️⚠️
- As a user, I should be able to report a conversation from the context menu; doing so sends an email to the support team with the last 5 messages of the conversation and ready-to-use admin SQL for applying sanctions.
- As a user, I should not see conversations from users I have blocked.
- As a user, I should see the diffusion compose box at the bottom of the chat list.
---

## 6. Single Chat Screen

*One-on-one direct messaging.*

- As a user, I should be able to share my current GPS location in the chat.⚠️⚠️
- As a user, I should see the chat automatically scroll to the newest message.⚠️⚠️
---

## 7. Group Chat Screen

*Multi-user group messaging.*


- As a user, I should receive new messages in real time without refreshing.✅⚠️
- As a user, I should see deleted messages disappear in real time.✅⚠️
- As a user, I should be able to tap a member's avatar to view their profile, if they have "make profile visible" set to true (make sure this is default!) on CommunitySettings / Privacy.
- As a user, I should be able to leave the group after confirming, and be redirected to the chat list; the group should disappear from my chat list immediately.
- As a user, after leaving a group I should no longer be in the members list, and the group composer should be replaced with "You're not a member of this group." until I rejoin.
- As a user who is the group admin/creator, I should be able to delete the group entirely after confirming.
- As a user, when the admin deletes a group I have open at that moment, I should see an Alba-native modal informing me it was deleted and be sent back to ChatListScreen automatically.
- As a user, I should be able to leave the group after confirming, and be redirected to the chat list; the group should disappear from my chat list immediately.
- As a user, after leaving a group I should no longer be in the members list, until I rejoin.
- As a user who is the group admin/creator, I should be able to delete the group entirely after confirming.
- As a user, when the admin deletes a group I have open at that moment, I should see an Alba-native modal informing me it was deleted and be sent back to ChatListScreen automatically.


---

## 8. Group Info Screen

*Group settings and member management.*
- As a user, I should be able to leave the group after confirming, and be redirected to the chat list.
- As a user who is the group admin/creator, I should be able to delete the group entirely after confirming.
- As a user who is the group admin/creator, I should be able to edit the group description.
- As a user who is the group admin/creator, I should be able to remove a member from the group after confirming.
---

## 9. Profile Screen

*Personal profile viewing and editing.*

- As a user, I should be able to set whether my profile is visible to all users or hidden.

---

## 10. Create Post Screen

*Composing and publishing new posts.*

- As a user, I should be able to select the type of post I want to create: Event, Ad, Article, Profile Post, or Product.
- As a user, I should be able to enter a title and description for my post.
- As a user, I should be able to attach one or more photos or videos from my gallery or camera.
- As a user, I should be able to set the post's location (auto-detected from GPS or entered manually).
- As a user, I should be able to set a publication date and time for my post.
- As a user creating an **Event**, I should be able to configure ticket options, pricing, and attendee limits.
- As an **event organizer**, I should be able to configure multiple ticket types with different prices.
- As a user creating an **Ad**, I should be able to enter product name, description, price, and contact information.
- As an **ad publisher**, I should be able to configure multiple product types/variations within one ad.
- As a user creating an **Article**, I should be able to write long-form content with a title and featured image.
- As a user creating a **Product** post, I should be able to enter product details and photos.
- As a user, I should be able to select relevant category tags for my post.
- As a user, I should be able to discard the post and return without saving.
- As a user, I should see a loading indicator while my post is being published.
- As a user, I should be automatically navigated away after successfully publishing a post.

---

## 11. Single Post Screen

*Viewing a single post in full detail.*

- As a user, I should see the full title, description, media, author, date, time, and location of a post.
- As a user, I should be able to play a video if the post contains one.
- As a user, I should be able to tap the post creator's name/avatar to visit their profile.
- As a user, I should be able to like/unlike the post.
- As a user, I should be able to save/unsave the post.
- As a user, I should be able to share the post.
- As a user, I should be able to report a post that does not belong to me.
- As a user who is the post's owner, I should be able to edit or delete the post.
- As a user, I should see a loading indicator while post details are being fetched.
- As a user, I should see an error message if the post is not found.

---

## 12. Saved Posts Screen

*Collection of posts the user has saved.*

- As a user, I should see all posts I have saved, ordered from most recently saved to oldest.
- As a user, I should see a thumbnail, title, and creator info for each saved post.
- As a user, I should be able to tap a saved post to open it in full (Single Post Screen).
- As a user, I should be able to unsave a post, removing it from my collection immediately.
- As a user, I should see an empty state message when my saved collection is empty.
- As a user, I should be able to pull down to refresh my saved posts.

---

## 13. Feed Settings Screen

*Personalising the video feed and screen-time limit.*

- As a user, I should be able to enable or disable the screen-time alert timer for the feed.
- As a user, I should be able to set the number of minutes before the screen-time alert fires (default: 15 min).
- As a user, I should be able to enable or disable distance-radius filtering for the feed.
- As a user, I should be able to set a maximum distance (in km) for radius filtering.
- As a user, I should be able to toggle individual category tags (Music, Art, Food, Travel, Sports, Fitness, Gaming, Fashion, Comedy, Dance, Nature, Tech, Film, Education, Lifestyle, Pets) to filter the feed.
- As a user, I should be able to type a free-text preference prompt to customise my feed using semantic search (max 300 characters).
- As a user, I should see a loading indicator while my preference prompt is being saved.
- As a user, I should see a "Saved ✓" confirmation after my preference prompt is saved.
- As a user, I should be able to clear my saved preference prompt.
- As a user, I should be able to navigate to my Saved Videos collection from this screen.

---

## 14. Community Settings Screen

*Account settings across General, Events, Ads, and Privacy tabs.*

**General Tab**
- As a user, I should be able to view and manage general account settings.
- As a user, I should be able to configure push notification preferences (chat messages, group messages, diffusion messages, new followers, followed users' posts).
- As a user, I should be able to set the daily screen-time notification time (default 8:00 AM) using a time dropdown.

**Events Tab**
- As an event organizer, I should be able to see a list of all events I have created.
- As an event organizer, I should be able to edit an event's details from this tab.
- As an event organizer, I should be able to delete an event from this tab.
- As an event organizer, I should be able to view the attendee list for each event.

**Ads Tab**
- As an ad publisher, I should be able to see all my active ads.
- As an ad publisher, I should be able to view ad performance statistics.
- As an ad publisher, I should be able to edit an ad's details.
- As an ad publisher, I should be able to pause or reactivate an ad.
- As an ad publisher, I should be able to delete an ad.

**Privacy Tab**
- As a user, I should be able to toggle whether I appear in the nearby user search.
- As a user, I should be able to manage my privacy and data preferences.

---

## 15. Event Settings Screen

*Management panel for a single event.*

- As an event organizer, I should be able to view my event's title, description, date, time, location, and cover image.
- As an event organizer, I should be able to edit all event details (title, description, date, time, location, cover image).
- As an event organizer, I should be able to see a list of confirmed attendees.
- As an event organizer, I should be able to see a list of unconfirmed (invited but not yet confirmed) attendees.
- As an event organizer, I should be able to select multiple unconfirmed attendees and send them an invite message.
- As an event organizer with a ticketed event, I should be able to scan a QR code from a camera view to validate attendee tickets.
- As an event organizer, I should see a confirmation message after successfully scanning a valid ticket.
- As an event organizer, I should see an error when scanning a ticket that has already been used.
- As an event organizer, I should be able to delete an event after confirming.
- As an event organizer, I should be able to view ticket types, pricing, and availability counts.
- As an event organizer, I should be able to share an event link via other apps.
- As an event organizer, I should be able to pull down to refresh the attendee list.

---

## 16. Past Events Screen

*Historical view of events that have already occurred.*

- As an event organizer, I should see a list of all my past events sorted from most recent to oldest.
- As an event organizer, I should be able to expand a past event to see the list of unconfirmed attendees.
- As an event organizer, I should be able to collapse an expanded event.
- As an event organizer, I should be able to select individual unconfirmed attendees using checkboxes.
- As an event organizer, I should be able to select all unconfirmed attendees at once.
- As an event organizer, I should be able to send a DM invite to all selected Alba users.
- As an event organizer, I should be able to compose an optional message to include with the invite.
- As an event organizer, I should see "Not on Alba yet" for unconfirmed attendees without an account, and not be able to select them for invite.
- As an event organizer, I should see an empty state when I have no past events.

---

## 17. My Tickets Screen

*All event tickets owned by the current user.*

- As a user, I should see a list of all upcoming events I have tickets for, sorted by nearest date first.
- As a user, I should see each event's title, date, time, and location.
- As a user, I should be able to expand an event to view its tickets.
- As a user, I should be able to collapse an event to hide its tickets.
- As a user, I should see a scannable QR code for each ticket, labelled with the ticket type and holder.
- As a user, I should be able to cancel my registration for an event after confirming in a dialog.
- As a user, I should be able to delete an individual ticket after confirming in a dialog.
- As a user, I should see an error message if cancellation or deletion fails.
- As a user, I should see an empty state when I have no upcoming tickets.

---

## 18. Ad Publisher Screen

*Management dashboard for users who publish ads.*

- As an ad publisher, I should see a list of all ads I have published (active and inactive).
- As an ad publisher, I should see performance statistics for each ad (views, purchases, contacts).
- As an ad publisher, I should be able to edit an existing ad's title, description, pricing, and photos.
- As an ad publisher, I should be able to pause an active ad, stopping it from appearing in feeds.
- As an ad publisher, I should be able to reactivate a paused ad.
- As an ad publisher, I should be able to permanently delete an ad after confirming.
- As an ad publisher, I should be able to see a list of users who purchased or contacted me through an ad.
- As an ad publisher, I should be able to tap a buyer's name to open a direct message conversation.
- As an ad publisher, I should be able to navigate to the Create Post screen to publish a new ad.
- As an ad publisher, I should see an empty state with a "Create your first ad" prompt when I have no ads.

---

## 19. Use Time Screen

*Personal screen-time tracking and goal management.*

- As a user, I should be able to see how much time I have spent on the app today.
- As a user, I should be able to see a visual progress bar showing my progress toward my daily usage goal.
- As a user, I should be able to set a daily usage goal (in minutes) using a slider.
- As a user, I should be able to save my daily goal.
- As a user, I should see a weekly bar chart of my usage for the past 7 days, colour-coded to show whether I met my goal each day.
- As a user, I should be able to see a breakdown of time spent in each section of the app (Feed, Community, Chat, etc.).
- As a user, I should see my current activity streak (consecutive days meeting my goal).
- As a user, I should see my all-time best streak.
- As a user, I should see the screen's colour scheme change dynamically based on my usage (green = on track, orange = moderate, red = exceeded goal).
- As a user, I should be able to scroll through historical usage data.
- As a user, I should be able to pull down to refresh my usage statistics.

---

## 20. Pre-Face Recognition Screen

*Introduction and entry point for identity verification.*

- As an unverified user without a profile picture, I should see a prompt and a button to "Upload photo" that takes me to my profile to add an avatar first.
- As an unverified user with a profile picture, I should see a "Start verification" button that takes me to the Face Recognition screen.
- As an already-verified user, I should be automatically redirected to the Community screen without seeing this screen.
- As a user, I should be able to go back to the previous screen using the back button.
- As a user, I should see a loading indicator while my verification status and avatar are being checked.

---

## 21. Face Recognition Screen

*Biometric selfie-based identity verification.*

- As a user, I should be prompted to grant camera permission on first use.
- As a user who denies camera permission, I should see a message explaining that the camera is needed.
- As a user, I should see a live camera viewfinder to take a selfie.
- As a user, I should be able to take a selfie by tapping the "Take photo" / "Verify" button.
- As a user, I should see a loading indicator while my selfie is being compared to my profile picture.
- As a user whose selfie matches my profile picture, I should be marked as verified and redirected to the Community screen.
- As a user whose selfie does not match (or no face is detected), I should see the message: "No face detected. Please take a photo where your face is clearly visible."
- As a user, I should be able to retry the verification if it fails.
- As a user, I should see a clear error message if the verification service is unavailable.
- As a user, I should see a clear error message if the verification request times out (20 seconds).

---

## 22. Saved Videos Screen

*Collection of feed videos the user has bookmarked.*

- As a user, I should see the "Saved Videos" header and back button overlaid over the full top of the screen (including status bar area) so the video never bleeds through behind the header.
- As a user, I should be able to scroll vertically through all feed videos I have saved, one per screen.
- As a user, I should see each video auto-play when it enters the viewport.
- As a user, I should be able to tap a video to pause or resume playback.
- As a user, I should see the video creator's username and caption overlaid on the video.
- As a user, I should be able to unsave a video by tapping the bookmark icon, removing it from my collection.
- As a user, I should see an empty state message when I have no saved videos.
- As a user, I should see a loading indicator while my saved videos are being fetched.
- As a user, I should be able to return to the previous screen using the back button.

---

## 23. Single Feed Video Screen

*Full-screen playback of a single feed video.*

- As a user, I should see a single feed video playing full-screen and looping continuously.
- As a user, I should see the video creator's avatar, username, and caption overlaid at the bottom.
- As a user, I should be able to tap the creator's information row to navigate to their profile.
- As a user, I should see a floating back button to return to the previous screen.
- As a user, I should see a loading indicator while the video and creator metadata are being fetched.
- As a user, I should see an error message if the video is unavailable.

---

---

# Developer Appendix

## A. Backend & Database

- **Trigger chain on `messages`**: Five triggers fire on each INSERT. Confirm all are using the current schema (`sender_id`, `chat_id`) with no references to deprecated columns (`owner_id`, `chat`, `sender_is_me`). Any trigger lacking an `EXCEPTION` handler will silently block all inserts.
- **`REPLICA IDENTITY FULL`**: Verify `messages` table has `REPLICA IDENTITY FULL` set, otherwise real-time DELETE events will not include column data and subscription filters will not match.
- **`get_or_create_dm_chat` RPC**: Confirm the function consistently uses `peer_profile_id` for lookup and insert, and does not create a duplicate chat on each session.
- **`deliver_message()` function**: Confirm it updates `chat_threads` using `chat_id` and does not reference non-existent columns (e.g. `unread_count`).
- **`on_message_delete` trigger**: Confirm it correctly finds the next most recent message and updates `last_content` / `last_message_id` in all affected `chat_threads` rows.
- **RLS policies on `messages`**: Verify policies reference `sender_id` (not the deprecated `owner_id`). Test that a user can only insert rows where they are the sender and can only read messages in chats they belong to.
- **RLS policies on `profiles`, `groups`, `posts`, `tickets`, `events`**: Validate that users cannot read or write rows they are not authorised to access.
- **Edge function `send-push`**: Verify the DM recipient lookup queries `owner_id` in `chat_threads`, not any deprecated column. Confirm the group notification path correctly reads `groups.members` as usernames. Remove diagnostic logs (`[send-push] DM chat_id:`, `[send-push] Expo response:`, etc.) once notifications are confirmed stable in production.
- **`ad_stats` tracking**: Confirm INSERT fires reliably when a new Ad post is created, and that views/purchases/contacts columns increment correctly.
- **`cancel_ticket_registration` and `delete_single_ticket` RPCs**: Test both with valid and invalid ticket IDs, including edge cases (already cancelled, non-existent ticket, not the owner).
- **Face verification Lambda**: Confirm the Lambda endpoint reads both base64 image payloads, calls AWS Rekognition, returns a confidence score, and handles missing faces gracefully. Confirm the timeout is handled on the client side (20 s abort signal).
- **`embed-text` edge function**: Confirm it accepts a text string, generates an embedding, and stores the vector in the correct profile column. Test with max-length (300-character) inputs.
- **Diffusion messages**: End-to-end test the `diffusion_message_receipts` webhook path in `send-push` — verify the correct recipient receives the notification and the `diffusion` preference flag is respected.

---

## B. Performance Under Different Conditions

- **Slow network (3G/throttled)**: Test video loading times in Feed and Saved Videos, message send latency in chats, and image upload progress in profile and group info screens. Confirm all screens have loading states and do not hang indefinitely.
- **No network / offline**: Verify graceful error messages are shown rather than crashes or blank screens. Check that locally cached data (message history, profile) is shown where available.
- **Large data sets**: Test Chat List with 50+ conversations. Test Feed with a large number of saved videos. Test Profile with 100+ posts. Test Group Info with 50+ members. Verify FlatList performance (no jank) and confirm pagination or lazy loading is functioning.
- **Cold start**: Measure app launch time from closed state. Confirm font loading and auth session retrieval do not cause excessive splash screen delay.
- **Memory under sustained use**: Confirm `ExpoImage.clearMemoryCache()` is called when the app returns to foreground. Monitor memory on older devices (iPhone SE 2nd gen, Android mid-range) after 30+ minutes of Feed usage. Confirm video buffer limits (`maxBufferMs: 10000`, `bufferForPlaybackMs: 2000`) prevent heap growth.
- **Real-time message volume**: Test Supabase real-time subscriptions with 10+ concurrent messages in a group. Confirm that INSERT and DELETE events arrive in order and the UI stays consistent.
- **Large media uploads**: Test uploading a 100 MB video in CreatePost. Confirm a progress indicator is shown and the upload does not time out.

---

## C. Device & OS Compatibility

- **iOS versions**: Test on iOS 16, 17, and 18 (latest). Confirm camera, notifications, location, and biometric permissions work across versions. Check for breaking changes introduced in iOS 17 (privacy manifests requirement) and iOS 18.
- **Android versions**: Test on Android 12, 13, and 14. Confirm FCM V1 push notifications are received on Android 13+ (where notification permission must be explicitly granted at runtime). Verify `expo-device` and `expo-notifications` behave correctly on each version.
- **Screen sizes**: Test on small screens (iPhone SE, Galaxy A-series) and large screens (iPad, Galaxy Tab, large Android phones). Verify no UI elements are clipped or off-screen.
- **Notch / Dynamic Island / punch-hole cameras**: Confirm safe-area insets are respected in all screens, especially the floating headers in SingleFeedVideoScreen and SavedVideosScreen.
- **Android adaptive icons**: Confirm the app icon renders correctly on Android launchers that apply different mask shapes (circle, squircle, etc.). Verify the icon is not oversized or undersized.
- **iPad / tablet**: Verify the layout is usable on wider screens (no stretched single-column layouts that look broken).
- **Accessibility**: Test with iOS VoiceOver and Android TalkBack enabled. Verify all interactive elements have accessible labels. Check text scaling at largest system font size.
- **Low-end devices**: Test on a device with 2 GB RAM. Confirm the video feed does not crash from memory pressure.

---

## D. Cybersecurity

- **Authentication tokens**: Confirm Supabase JWT tokens are stored in secure storage (not AsyncStorage in plaintext). Verify tokens are refreshed automatically and expired sessions redirect to login.
- **Row-Level Security**: Attempt to access another user's private data by manipulating API calls. Verify RLS blocks all unauthorised access to `profiles`, `messages`, `chat_threads`, `tickets`, `groups`, and `posts`.
- **Face verification endpoint**: Confirm the Lambda URL is not exposed client-side in a way that allows unauthenticated calls. Verify the endpoint validates the calling user's identity before updating `is_verified`.
- **Input sanitisation**: Test all text inputs (bio, post title, group name, preference prompt) with HTML, SQL injection strings, and unusually long strings. Confirm no XSS vectors exist in rendered content.
- **Media upload**: Confirm uploaded files are stored with non-guessable paths. Verify that only the uploading user can overwrite their own avatar/cover. Test uploading non-image/video file types and confirm they are rejected.
- **Push token leakage**: Confirm `push_token` is never exposed to other users via any public query or profile endpoint.
- **VPN detection on Community**: Verify the VPN-blocking logic cannot be trivially bypassed by a determined user and that the block does not return sensitive error details.
- **Stripe**: Confirm the publishable key (not secret key) is the only Stripe credential exposed in the client bundle. Verify webhook signatures are validated server-side.
- **Environment variables**: Audit `EXPO_PUBLIC_*` variables to ensure no secret keys (Supabase service role key, Stripe secret key, Lambda secret) are included in the client bundle.
- **QR code ticket scanning**: Confirm a scanned ticket can only be validated by the organiser of the corresponding event. Verify a ticket cannot be reused (idempotency of the `scanned` array update).

---

## E. Content Moderation

- **User-generated text**: Post titles, descriptions, bio, group names, and chat messages can contain arbitrary text. Confirm a reporting mechanism exists (report post, report chat) and that reports are logged in the database for manual review.
- **User-generated media**: Uploaded images and videos in posts, avatars, cover photos, and group avatars have no automated content filtering currently. Consider integrating an image moderation API (e.g. AWS Rekognition content moderation) before scaling to a large user base.
- **Blocking users**: Test that blocking a user hides their chats, prevents new DMs, and removes them from nearby user search results.
- **Age restriction**: Registration is limited to users 18+. Confirm this is enforced both client-side (age picker starts at 18) and server-side (check age on profile creation).
- **Face verification misuse**: A verified badge increases user trust. Confirm the verification flow cannot be gamed (e.g. by submitting a photo of a photo) and that verification status can be revoked by an admin.
- **Diffusion messages**: These are sent by one user to many recipients simultaneously. Confirm spam or harassment via diffusion is tracked and that a recipient can mute or block the sender.

---

## F. Dependencies — Deprecated or Potentially Unreliable

- **`expo-notifications`**: Actively maintained, but Expo SDK upgrades can introduce breaking changes. Pin the version in `package.json` and review release notes before any SDK upgrade.
- **`expo-device`**: Stable, but check for changes to `isDevice` detection in future SDK versions (Expo Go vs standalone build).
- **`expo-image`**: Actively maintained; `clearMemoryCache()` API could change. Monitor for deprecation of the method signature.
- **FCM V1 (Firebase Cloud Messaging)**: Google deprecated the legacy FCM HTTP API in June 2024 and has disabled it. The app now correctly uses FCM V1, but the service account JSON credential expires if the Firebase project is deleted or the key is rotated. Set a calendar reminder to rotate the key annually.
- **Expo Push Service**: The Expo Push Service is a third-party intermediary that delivers to APNs and FCM. If Expo discontinues or changes its free tier, push notifications would require direct APNs/FCM integration.
- **`@stripe/stripe-react-native`**: Stripe SDK updates frequently. Confirm the installed version is compatible with the current Expo SDK. Watch for changes to the `StripeProvider` API.
- **`react-native-vision-camera` or `expo-camera`**: Whichever camera library is in use for face recognition — confirm it is compatible with the target Expo SDK. Camera APIs on iOS 17+ require `NSCameraUsageDescription` in the privacy manifest.
- **AWS Lambda / Rekognition**: The face verification Lambda is a custom deployment. Confirm the Lambda has a monitoring alarm, a timeout (currently 20 s on the client), and that the Rekognition API pricing is accounted for at scale.
- **Mapbox (location detection at sign-up)**: If the Mapbox SDK or geocoding API key is not renewed, city detection at sign-up will silently fail. Confirm the API key has no expiry or has renewal reminders set.
- **`esm.sh` imports in Supabase edge functions**: The `send-push` edge function imports `@supabase/supabase-js` from `https://esm.sh/`. Pin to a specific version (e.g. `@2.39.0`) to prevent unexpected breaking changes from an automatic CDN update.

---

## G. User Data Handling

- **Personal data stored**: Name, email, username, age, gender, city, bio, avatar, cover photo, GPS coordinates (at sign-up and post creation), push token, notification preferences, screen-time data, saved posts/videos, face verification status.
- **GDPR / data deletion**: Confirm there is an account deletion flow that removes or anonymises all of the above. Verify cascading deletes are in place in the database (or that a deletion function covers all tables).
- **Push token rotation**: Expo push tokens can change (e.g. after app reinstall). Confirm `savePushToken()` is called on every login to ensure the stored token is always current, and that stale tokens are handled gracefully by the push service.
- **Location data**: GPS coordinates are stored with posts and used for proximity search. Confirm users are clearly informed about this in the sign-up flow or privacy policy. Confirm location is not stored beyond what is needed.
- **Face biometric data**: Profile photos used for verification are transmitted to an external Lambda/Rekognition service. Confirm the images are not stored by the Lambda and that users are informed their biometric data is processed externally.
- **Screen-time data**: Usage time is stored per user. Confirm it is only readable by the user themselves (RLS policy), and not exposed to other users or third parties.
- **Supabase service role key**: Must never appear in the client bundle. It is used only in edge functions. Audit the build output to confirm.
- **Stripe**: No full card numbers are stored server-side. Confirm only Stripe customer/payment intent IDs are stored in the database.

---

## H. Codebase Efficiency & Best Practices

- **Debug logs in production**: `SingleChatScreen` and `GroupChatScreen` both contain `console.log` statements added for the messaging diagnosis. Remove these before a production release. Similarly, the `send-push` edge function contains verbose diagnostic logs that should be removed or gated behind an environment flag.
- **Supabase channel cleanup**: Confirm all `supabase.channel(...).subscribe()` calls have a corresponding `channel.unsubscribe()` in their `useEffect` cleanup function. Leaking subscriptions cause memory growth and unexpected behaviour after navigation.
- **`useEffect` dependency arrays**: Audit effects that reference state or props to ensure dependency arrays are complete. Missing dependencies can cause stale-closure bugs; excessive dependencies can cause infinite loops.
- **Image compression consistency**: Profile avatar, cover photo, group avatar, and post media all perform their own resize/compress logic inline. Consider extracting to a shared `compressImage(uri, maxSize, quality)` utility to reduce duplication.
- **`maybeSingle()` vs `single()`**: Supabase `single()` throws an error when no row is found, while `maybeSingle()` returns `null`. Audit all DB calls to confirm the correct method is used and that `null` results are handled.
- **AsyncStorage vs Supabase for settings**: Screen-time timer threshold is stored in AsyncStorage, while notification preferences and feed settings are in Supabase. Consider consolidating all user preferences in Supabase for consistency across devices.
- **Re-renders from inline functions**: Components that pass arrow functions as props (e.g. `onPress={() => ...}`) create new function references on every render. In performance-critical FlatList render items, wrap callbacks in `useCallback`.
- **Missing error boundaries**: No React error boundary is present at the navigation level. A single unhandled render error will crash the whole app. Add a top-level error boundary with a fallback UI.
- **Font loading blocking render**: The app waits for both `ready` (session check) and `fontsLoaded` before rendering. If either is slow (e.g. network timeout on font fetch from a CDN), the user sees only a spinner. Confirm fonts are bundled locally and not fetched from a remote URL.
- **`Constants.appOwnership === "expo"` guard**: `registerForPushNotifications()` returns early in Expo Go. Confirm this guard is not accidentally blocking registration in production builds where `appOwnership` is `null`.
- **Stripe key fallback chain**: The publishable key falls back through `process.env` → `Constants.expoConfig.extra` → `""`. An empty string will cause Stripe to fail silently. Add an explicit warning log if the key is empty at startup.
- **`on_message_delete` trigger performance**: The trigger queries `messages` to find the previous message on every DELETE. Add an index on `(chat_id, created_at DESC)` if not already present to keep this fast at scale.
