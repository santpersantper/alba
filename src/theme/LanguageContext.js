import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";

const STORAGE_KEY = "alba_language";

const STRINGS = {
  en: {
    group_info_title: "Group info",
    search_members_placeholder: "Search members",
    group_exit_success: "You left this group.",
    group_report_success: "Thanks for your report.",
    report_sent_body: "We'll review it and take action if it goes against our guidelines.",
    exit_group_button: "Exit group",
    report_group_button: "Report group",
    report_group_title: "Report group",
    report_group_placeholder: "Tell us briefly what is wrong",
    report_message_title: "Report message",
    cancel_button: "Cancel",
    submit_button: "Send",
    delete_group_button: "Delete group",

    /* ---------- CommunitySettings ---------- */
    community_settings_title: "Community Settings",
    appearance_section_title: "Appearance",
    night_auto: "Night mode: automatic after sunset",
    night_on: "Night mode: always on",
    night_off: "Night mode: always off",
    show_local_news: "Show local news / articles",
    profile_visible_to_all: "Make your profile visible to anyone",
    allow_dms_anyone: "Allow DMs from anyone",
    saved_posts_button: "See my saved posts",

    language_section_title: "Language",
    language_en: "English",
    language_it: "Italian",

    /* ---------- Tabs / screens ---------- */
    community_tab_title: "Community",

    /* ---------- CreatePostScreen ---------- */
    create_post_header_title: "Create Post",
    create_post_title_label: "Title",
    create_post_description_placeholder: "Your post's text",
    create_post_any_date: "Any date",
    create_post_any_time: "Any time",
    create_post_add_media_button: "Add Media",
    create_post_post_type_title: "Post Type",
    create_post_post_type_event: "Event",
    create_post_post_type_ad: "Ad",
    create_post_post_type_article: "Article",
    create_post_post_type_profile: "Profile Post",
    create_post_post_type_product: "Product",
    create_post_location_placeholder: "Location",

    create_post_error_title_required: "Title is required.",
    create_post_error_not_authenticated: "Not authenticated.",
    create_post_error_location_denied: "Location permission denied.",
    create_post_error_media_permission:
      "Permission required to access media library.",
    create_post_error_media_required: "Please add at least one photo or video.",
    create_post_error_event_fields_required:
      "For events, date, time and location are required.",
    create_post_success_title: "Success",
    create_post_success_message: "Post created!",
    create_post_fail_title: "Failed to create post",

    /* ---------- Generic actions (used in Post / EventPanel / AdPanel) ---------- */
    actions_tickets: "Tickets",
    actions_join_chat: "Join event chat",
    actions_share: "Share",
    actions_save: "Save",
    actions_buy: "Buy",
    actions_message_seller: "Message seller",

    /* ---------- Post captions ---------- */
    caption_read_more: "Read more",

    /* ---------- Post menu / confirm ---------- */
    menu_translate: "Translate",
    menu_report: "Report",
    menu_save: "Save",
    menu_saved: "Saved",
    menu_delete: "Delete",
    confirm_delete_title: "Are you sure you want to delete your post?",
    confirm_yes: "Yes",
    confirm_no: "No",

    filter_any_date: "Any date",
    filter_any_time: "Any time",
    filter_morning_range: "Morning (6-12)",
    filter_afternoon_range: "Afternoon (12-20)",
    filter_night_range: "Night (20-6)",

    /* ---------- EventPanel ---------- */
    event_checkbox_group_chat: "Create public event group chat",
    event_checkbox_ticketing: "Allow in-app ticketing",
    event_ticket_general: "General",
    event_ticket_vip: "VIP",
    event_ticket_name: "Ticket name",
    event_free_label: "Free",
    event_cost_label: "Cost:",
    event_required_info_title: "Required buyer info",
    event_required_info_placeholder: "Example: name, age, etc.",
    event_add_ticket_button: "Add ticket type",
    event_actions_title: "Select actions",
    event_action_allow_subgroups: "Allow users to create sub-groups",
    event_action_allow_invites: "Allow users to invite others to chat",

    /* ---------- AdPanel ---------- */
    ad_checkbox_target_interested: "Target to interested users only",
    ad_checkbox_iap: "Allow in-app purchases",
    ad_product_name_placeholder: "Product name",
    ad_cost_label: "Cost:",
    ad_required_info_title: "Required buyer info",
    ad_required_info_placeholder: "Example: name, age, etc.",
    ad_add_product_button: "Add product",

    /* ---------- Labels / CommunityScreen ---------- */
    label_sports: "Sports",
    label_parties: "Parties",
    label_cultural: "Cultural events",
    label_music: "Music",
    label_science_tech: "Science & Tech",
    label_culinary: "Culinary",
    label_english_speaking: "English-speaking",

    labels_add_button: "+ Add",
    labels_new_label_placeholder: "New label",

    community_any_date: "Any date",
    community_any_time: "Any time",
    community_time_morning: "Morning",
    community_time_afternoon: "Afternoon",
    community_time_night: "Night",
    community_time_morning_range: "Morning (6–12)",
    community_time_afternoon_range: "Afternoon (12–20)",
    community_time_night_range: "Night (20–6)",
    community_no_events_for_filters: "No events for this date/time.",

    /* ---------- Verification flow ---------- */
    verification_pre_title: "Get verified",
    verification_pre_body:
      "To keep our Community organic and genuine, we require all users to go through facial verification before they talk to others.",
    verification_pre_button_start: "Start",
    verification_pre_button_upload: "Upload profile picture",

    verification_face_title: "Face verification",
    verification_face_body:
      "We’ll compare your face from different angles with your profile picture to confirm that it’s really you.",
    verification_face_button_dev_complete: "I'm done – mark me as verified",

    avatar_invalid_title: "Profile picture",
    avatar_invalid_message:
      "Please upload a profile picture where your face is visible.",

    /* ---------- Chat / blocking ---------- */
    chat_user_blocked_snippet: "User blocked.",
    chat_single_blocked_body:
      "This user is blocked. To see their messages, you have to unblock them.",
    chat_single_unblock_cta: "Unblock",
    chat_single_unblock_confirm_title:
      "Are you sure you want to unblock this user?",
    chat_single_unblock_confirm_no: "No",
    chat_single_unblock_confirm_yes: "Yes",

    group_message_member: 'Message this user',
    group_make_admin: 'Make this user admin',
    group_remove_member: 'Remove this user',
    group_subgroups_title: 'Subgroups',
    group_members_title: 'Members',
    group_add_subgroup_button: 'Add subgroup',
    group_invite_user_button: 'Invite users',
    group_new_subgroup_placeholder: 'New subgroup',

    create_post_post_type_feed: 'Feed Post',
    chat_search_people_title: 'Users',
    chat_search_message_button: 'Message',
    loading_text: 'Loading',

    signup_name_placeholder: 'Firstname Lastname',
    signup_email_placeholder: 'Email',
    signup_username_placeholder: 'username',
    signup_password_placeholder: 'Password',
    signup_age_placeholder: 'Age',
    signup_age_picker_title: 'Age',
    signup_picker_done: 'Done',
    signup_gender_placeholder: 'Gender',
    signup_gender_picker_title: 'Gender',
    signup_city_placeholder: 'City',
    signup_button_label: 'Sign up',

    chat_search_no_matching_users: 'No matching users.',
    logout_title: 'Log out',
    logout_confirm: 'Are you sure you want to log out?',

    // ✅ Community area slider
    settings_area_title: "Select Community area",
    settings_area_helper:
      "You will only get events, people and ads within this distance of your location",
    settings_meters: "meters",

    // ✅ EventSettings / AdSettings labels
    event_settings_tags_title: "What events do you want to see?",
    event_settings_tags_placeholder: "Music concerts, sports, climbing, etc.",
    ad_settings_tags_title: "What ads do you want to see?",
    ad_settings_tags_placeholder: "Food places near Piola, vintage markets",

    signup_have_account_prefix: "Already have an account?",
    login_button_label: 'Log in',

    event_settings_title: 'Event Settings',
    edit_event_post: 'Edit event post',
    change_date_time: 'Change date and time',
    ticket_holders: 'Ticket holders',
    unconfirmed: 'Unconfirmed',
    dm_whole_list: 'DM whole list',
    invite_previous_event: 'Invite users from previous event',
    invite_users: 'Invite users',
    delete_event: 'Delete event',    
    change_location: "Change location",
    not_on_alba_yet: "not on Alba yet",

    past_events: "Past events",    
    delete_event_confirm: "Do you want to delete this event?",
    remove_user_confirm: "Do you want to remove this user?",
    open_attendees_list: "Open attendees list",
    close_attendees_list: "Close attendees list",    
    select_all: 'Select all',
    invite: 'Invite',
    invite_default_message: "let's go to this event",

    my_tickets_title: 'My tickets',
    no_qr_found: 'No QR tickets found for this event yet.',

    /* ---------- Follow / ProfileScreen ---------- */
    profile_follow: "Follow",
    profile_following: "Following",
    profile_blocked_label: "Blocked",
    profile_message_button: "Message",
    profile_report_label: "Report",
    profile_block_label: "Block",
    profile_unblock_label: "Unblock",
    profile_cancel_label: "Cancel",
    profile_report_user_title: "Report user",
    profile_report_placeholder: "Describe the issue...",
    profile_thanks_report: "Thanks for letting us know.",
    profile_bio_add: "Add a bio...",
    profile_bio_read_more: "Read more",
    profile_bio_save: "Save",
    profile_bio_saving: "Saving...",
    profile_couldnt_save_bio: "Couldn't save bio.",
    profile_no_posts: "hasn't made any posts yet.",

    /* ---------- CommunitySettings – General tab ---------- */
    settings_profile_section: "Profile",
    settings_verified: "Verified",
    settings_not_verified: "Not verified — tap to get verified and unlock posting & chat",
    settings_name_placeholder: "Name",
    settings_username_placeholder: "Username",
    settings_checking_username: "Checking availability…",
    settings_username_available: "Available",
    settings_username_taken: "Already taken",
    settings_username_invalid: "Must be at least 3 characters",
    settings_password_placeholder: "New password (leave blank to keep)",
    settings_confirm_password: "Confirm new password",
    settings_save_changes: "Save changes",
    settings_saved: "Saved!",
    settings_blocked_users_title: "Blocked users",
    settings_no_blocked: "You haven't blocked anyone.",
    show_followed_posts: "Show posts from followed users",

    /* ---------- Feed screen ---------- */
    feed_loading: "Loading videos…",
    feed_no_videos: "No videos yet",
    feed_report_menu: "Report",
    feed_block_menu: "Block user",
    feed_delete_menu: "Delete",
    feed_report_title: "Why do you want to report this user?",
    feed_report_placeholder: "Describe the issue...",
    feed_block_title: "Are you sure you want to block this user?",
    feed_delete_title: "Are you sure you want to delete this post?",
    feed_blocked_toast: "You've blocked this user.",
    feed_reported_toast: "You reported this user.",
    feed_break_title: "Time for a break!",
    feed_break_message: "You've been watching for {n} minute(s).",
    ok_button: "OK",
    feed_couldnt_delete: "Couldn't delete this post.",
    feed_deleted_toast: "Post deleted.",

    /* ---------- FeedSettings screen ---------- */
    feed_settings_title: "Feed Settings",
    feed_settings_timer_title: "Show use-time timer",
    feed_settings_timer_sub: "Display a timer on Feed showing how long you've been watching",
    feed_settings_alert_title: "Alert me after",
    feed_settings_minutes: "minutes",
    feed_settings_hint: "When the timer reaches your limit, you'll receive a reminder to take a break.",
    feed_settings_saved_videos: "See my saved videos",

    /* ---------- Saved Videos screen ---------- */
    saved_videos_title: "Saved Videos",
    saved_videos_empty: "No saved videos yet",

    /* ---------- Post / caption ---------- */
    caption_read_less: "Read less",

    /* ---------- Chats screen ---------- */
    chats_title: "Chats",

    /* ---------- CreatePost – publish button ---------- */
    create_post_publish_button: "Publish",

    /* ---------- MyEvents ---------- */
    my_events_chat: "Event chat",
    my_events_settings: "Settings",

    /* ---------- MyAds ---------- */
    my_ads_settings: "Ad settings",

    /* ---------- CommunitySettings – Premium section ---------- */
    premium_section_title: "Alba Premium",
    premium_ad_free_label: "Ad-Free",
    premium_ad_free_sub: "Browse Community without ads — €5.00/month",
    premium_traveler_label: "Traveler Mode",
    premium_traveler_sub: "Access Community in any city worldwide — €4.99/month",
    premium_traveler_city_placeholder: "Search for a city...",
    premium_traveler_browsing: "Currently browsing as: {city}",
    premium_traveler_no_city: "No city selected — Community will use your real location",
    premium_diffusion_label: "Diffusion List",
    premium_diffusion_sub: "Broadcast a message to all Alba users nearby — €1.00 per message",
    premium_broadcast_radius: "Broadcast radius",
    premium_radius_hint: "Min 1 {unit} · Max 50 {unit}",
    premium_reach_users: "Your message will reach approximately {n} users",

    /* ---------- CommunitySettings – Notifications ---------- */
    notif_section_title: "Notifications",
    notif_direct_messages: "Direct Messages",
    notif_direct_messages_sub: "Notify when you receive a new direct message",
    notif_group_messages: "Group Messages",
    notif_group_messages_sub: "Notify when someone sends a message in a group",
    notif_diffusion: "Diffusion Messages",
    notif_diffusion_sub: "Notify when you receive a broadcast message",
    notif_followed_posts: "Posts from followed accounts",
    notif_followed_posts_sub: "Notify when accounts you follow create a new post",

    /* ---------- CommunitySettings – Logout / Delete ---------- */
    settings_logout: "Log out",
    settings_delete_account: "Delete account",
    settings_delete_title: "Delete your account?",
    settings_delete_body: "This permanently deletes your profile, posts, and all data. This cannot be undone.",
    settings_delete_confirm: "Delete",

    /* ---------- Ticket & Ad payout sections ---------- */
    payout_ticket_title: "Ticket payouts",
    payout_ticket_no_event: "If you organise events and sell tickets on Alba, you can connect a bank account here to receive ticket revenue directly. Create an event first to get started.",
    payout_ticket_connected: "Your bank account is connected. Ticket sales will be transferred to you automatically, minus a small platform fee.",
    payout_ticket_pending: "Onboarding started — please complete verification on Stripe to receive payments.",
    payout_ticket_not_setup: "Connect a bank account to receive ticket revenue directly. Alba collects a small platform fee per transaction; the rest goes straight to you.",
    payout_product_title: "Product sale payouts",
    payout_product_connected: "Your bank account is connected. Payments from product sales will be transferred to you automatically, minus a small platform fee.",
    payout_product_pending: "Onboarding started — please complete verification on Stripe to receive payments.",
    payout_product_not_setup: "If you sell products directly from your ads on Alba, connect a bank account here to receive payments. Alba collects a small platform fee per transaction; the rest goes straight to you.",
    payout_status_connected: "Connected",
    payout_status_pending: "Pending verification",
    payout_status_not_setup: "Not set up",
    payout_continue_setup: "Continue setup",
    payout_setup: "Set up payouts",
    payout_reset_event: "Reset event preference settings",
    payout_reset_ad: "Reset ad preference settings",
    payout_instructions_label: "Instructions",
    payout_instructions_helper: "Not sure how to set up payouts? See instructions on our website",

    /* ---------- Ad Dashboard (AdPublisherScreen) ---------- */
    ad_dashboard_title: "Ad Dashboard",
    ad_tab_overview: "Overview",
    ad_tab_performance: "Performance",
    ad_tab_my_ads: "My Ads",
    ad_tab_buyers: "Buyers",
    ad_all_campaigns: "ALL CAMPAIGNS",
    ad_stat_buy_rate: "Buy rate",
    ad_stat_message_rate: "Message rate",
    ad_stat_total_results: "Total results",
    ad_active: "active",
    ad_see_all: "See all {n} ads →",
    ad_create_new: "Create new ad",
    ad_create_first: "Create first ad",
    ad_loading: "Loading your ads…",
    ad_untitled: "Untitled ad",
    ad_no_date: "No date",
    ad_your_ads: "YOUR ADS",
    ad_viewing_ad: "VIEWING AD",
    ad_select_ad: "Select an ad",
    ad_results_label: "RESULTS",
    ad_buy_rate_hint: "Viewers who purchased",
    ad_msg_rate_label: "Message rate",
    ad_msg_rate_hint: "Viewers who messaged",
    ad_cost_per_sale: "Cost per sale",
    ad_cost_per_sale_hint: "Spend ÷ purchases",
    ad_cost_per_inquiry: "Cost per inquiry",
    ad_cost_per_inquiry_hint: "Spend ÷ messages",
    ad_locked_cost: "Cost metrics will unlock once budget tracking is added to your campaigns.",
    ad_compare_all: "COMPARE ALL ADS",
    ad_purchases: "Purchases",
    ad_inquiries: "Inquiries",
    ad_chart_no_data: "No data yet — this will fill in as people interact with your ads.",
    ad_buy_rate_short: "buy rate",
    ad_msg_rate_short: "msg rate",
    ad_results_short: "results",
    ad_details: "Details →",
    ad_no_performance_title: "No performance data yet",
    ad_no_performance_body: "Create your first ad to start tracking views, purchases, and inquiries.",
    ad_no_ads_title: "No ads yet",
    ad_no_ads_body: "Create your first campaign to start reaching locals in your area.",
    ad_edit_title: "Edit ad",
    ad_title_label: "Title",
    ad_description_label: "Description",
    ad_date_label: "Date",
    ad_time_label: "Time",
    ad_location_label: "Location",
    ad_save_changes: "Save changes",
    ad_delete_title: "Delete this ad?",
    ad_delete_body: "This will permanently remove the ad and all its stats. This cannot be undone.",
    ad_delete_confirm: "Delete",
    ad_cancel: "Cancel",
    ad_error_save: "Could not save changes.",
    ad_error_delete: "Could not delete ad.",
    ad_summary_one: "You have 1 ad active",
    ad_summary_many: "You have {n} ads active",
    ad_info_overview: "On Alba, your ads reach real people nearby who've opted in — not anonymous strangers. Fewer impressions, much higher intent.",
    ad_info_performance: "On Alba, ads reach opted-in users nearby — not the entire internet. Expect lower numbers but significantly higher intent and relevance.",

    /* ---------- UseTimeScreen ---------- */
    usetime_title: "Screen Time",
    usetime_allow_track: "Allow Alba to track your social media time",
    usetime_ios_android: "We use Apple's Screen Time framework on iOS\nand Usage Access on Android.\nYour data never leaves your device.",
    usetime_enable: "Enable Screen Time",
    usetime_observation_title: "Observation period",
    usetime_observation_days: "Alba is learning your habits. {n} day{s} until your personalised goal is set.",
    usetime_observation_computing: "Computing your first-week baseline…",
    usetime_no_data: "No data yet",
    usetime_social_today: "Social media time today",
    usetime_social_week: "Social media time this week",
    usetime_tracking_active: "Tracking active",
    usetime_tracking_paused: "Tracking paused",
    usetime_tap_deactivate: "Tap to deactivate",
    usetime_tap_reenable: "Tap to re-enable tracking",
    usetime_my_goals: "My current goals:",
    usetime_reduction_pct: "{n}% reduction per week",
    usetime_change: "Change",
    usetime_weekly_goal_title: "Weekly reduction goal",
    usetime_per_week: "% per week",
    usetime_daily_max_title: "Daily maximum",
    usetime_steps_hint: "30 min – 8 hours, in 15-minute steps",
    usetime_pause_title: "Pause tracking?",
    usetime_pause_sub: "Please let us know why you want to stop — it helps us improve Alba.",
    usetime_reason_accomplished: "Already accomplished my goal",
    usetime_reason_no_longer: "No longer want to reduce screen time",
    usetime_reason_other: "Other",
    usetime_other_placeholder: "Tell us more…",
    usetime_confirm: "Confirm",
    usetime_building_habits: "Building good habits 🎯",
    usetime_on_fire: "You're on fire! 🔥",
    usetime_keep_streak: "Keep the streak going! 💚",
    usetime_back_on_track: "Let's get back on track 💪",
    usetime_good_recovery: "Good recovery! Keep going 💪",
    usetime_making_progress: "You're making progress! 🎯",
    usetime_below_label: "You are {pct}% below {label}",
    usetime_above_label: "You are {pct}% above {label}",
    usetime_same_as: "Same as {label}",
    usetime_from_goal: "You are {time} from your daily goal",
    usetime_over_goal: "You are {time} over your daily goal",
    usetime_hit_goal: "You've hit your daily goal exactly",
    usetime_less_than_h: "Less than {h}h a day",
    usetime_less_than_hm: "Less than {h}h {m}min a day",
    usetime_yesterday: "yesterday",
    usetime_last_day: "last {day}",

    /* ---------- GroupInfoScreen ---------- */
    group_subgroup_see: "See",
    group_subgroup_join: "Join",
    group_meta: "Group · {n} member",
    group_meta_plural: "Group · {n} members",
    group_require_approval: "Require approval to join",
    group_require_approval_sub: "New members must be approved by an admin",
    group_review_links: "Review messages with links",
    group_review_links_sub: "Members are warned when sending messages containing links",
    group_pending_requests: "Pending requests ({n})",
    group_approve: "Approve",
    group_decline: "Decline",
    group_remove_admin: "Remove admin",
  },

  it: {

    group_info_title: "Informazione gruppo",
    search_members_placeholder: "Cerca membri",
    group_exit_success: "Hai lasciato questo gruppo.",
    group_report_success: "Grazie per la tua segnalazione.",
    report_sent_body: "Lo esamineremo e agiremo se va contro le nostre linee guida.",
    exit_group_button: "Uscire dal gruppo",
    report_group_button: "Segnalare gruppo",
    report_group_title: "Segnalare gruppo",
    report_group_placeholder: "Perché segnalare questo gruppo",
    report_message_title: "Segnala messaggio",
    cancel_button: "Annullare",
    submit_button: "Inviare",
    delete_group_button: "Cancellare gruppo",

    /* ---------- CommunitySettings ---------- */
    community_settings_title: "Impostazioni Community",
    appearance_section_title: "Aspetto",
    night_auto: "Modalità notte: automatica dopo il tramonto",
    night_on: "Modalità notte: sempre attiva",
    night_off: "Modalità notte: sempre disattivata",
    show_local_news: "Mostra notizie / articoli locali",
    profile_visible_to_all: "Rendi il tuo profilo visibile a tutti",
    allow_dms_anyone: "Permetti messaggi privati da chiunque",
    saved_posts_button: "Vedi i miei post salvati",

    language_section_title: "Lingua",
    language_en: "Inglese",
    language_it: "Italiano",

    /* ---------- Tabs / screens ---------- */
    community_tab_title: "Community",

    /* ---------- CreatePostScreen ---------- */
    create_post_header_title: "Crea post",
    create_post_title_label: "Titolo",
    create_post_description_placeholder: "Testo del tuo post",
    create_post_any_date: "Qualsiasi data",
    create_post_any_time: "Qualsiasi ora",
    create_post_add_media_button: "Aggiungi foto/video",
    create_post_post_type_title: "Tipo di post",
    create_post_post_type_event: "Evento",
    create_post_post_type_ad: "Annuncio",
    create_post_post_type_article: "Articolo",
    create_post_post_type_profile: "Post profilo",
    create_post_post_type_product: "Prodotto",
    create_post_location_placeholder: "Posizione",

    create_post_error_title_required: "Il titolo è obbligatorio.",
    create_post_error_not_authenticated: "Non sei autenticato.",
    create_post_error_location_denied: "Permesso posizione negato.",
    create_post_error_media_permission:
      "Serve il permesso per accedere alla libreria.",
    create_post_error_media_required:
      "Aggiungi almeno una foto o un video.",
    create_post_error_event_fields_required:
      "Per gli eventi, data, orario e posizione sono obbligatori.",
    create_post_success_title: "Fatto",
    create_post_success_message: "Post creato!",
    create_post_fail_title: "Errore nella creazione del post",

    /* ---------- Generic actions ---------- */
    actions_tickets: "Biglietti",
    actions_join_chat: "Chat dell'evento",
    actions_share: "Condividi",
    actions_save: "Salva",
    actions_buy: "Compra",
    actions_message_seller: "Scrivi al venditore",

    /* ---------- Post captions ---------- */
    caption_read_more: "Mostra altro",

    /* ---------- Post menu / confirm ---------- */
    menu_translate: "Traduci",
    menu_report: "Segnala",
    menu_save: "Salva",
    menu_saved: "Salvato",
    menu_delete: "Elimina",
    confirm_delete_title: "Sei sicuro di voler eliminare il post?",
    confirm_yes: "Sì",
    confirm_no: "No",

    filter_any_date: "Qualsiasi data",
    filter_any_time: "Qualsiasi orario",
    filter_morning_range: "Mattina (6–12)",
    filter_afternoon_range: "Pomeriggio (12–20)",
    filter_night_range: "Sera / notte (20–6)",

    /* ---------- EventPanel ---------- */
    event_checkbox_group_chat: "Crea una chat pubblica per l'evento",
    event_checkbox_ticketing: "Permetti la biglietteria in app",
    event_ticket_general: "Generale",
    event_ticket_vip: "VIP",
    event_ticket_name: "Nome biglietto",
    event_free_label: "Gratis",
    event_cost_label: "Costo:",
    event_required_info_title: "Dati richiesti all’acquirente",
    event_required_info_placeholder: "Esempio: nome, età, ecc.",
    event_add_ticket_button: "Aggiungi tipo di biglietto",
    event_actions_title: "Seleziona azioni",
    event_action_allow_subgroups:
      "Permetti agli utenti di creare sottogruppi",
    event_action_allow_invites:
      "Permetti agli utenti di invitare altri in chat",

    /* ---------- AdPanel ---------- */
    ad_checkbox_target_interested: "Mostra solo a utenti interessati",
    ad_checkbox_iap: "Permetti acquisti in app",
    ad_product_name_placeholder: "Nome prodotto",
    ad_cost_label: "Costo:",
    ad_required_info_title: "Dati richiesti all’acquirente",
    ad_required_info_placeholder: "Esempio: nome, età, ecc.",
    ad_add_product_button: "Aggiungi prodotto",

    /* ---------- Labels / CommunityScreen ---------- */
    label_sports: "Sport",
    label_parties: "Feste",
    label_cultural: "Eventi culturali",
    label_music: "Musica",
    label_science_tech: "Scienza & Tech",
    label_culinary: "Cucina",
    label_english_speaking: "Inglese",

    labels_add_button: "+ Aggiungi",
    labels_new_label_placeholder: "Nuova etichetta",

    community_any_date: "Qualsiasi data",
    community_any_time: "Qualsiasi orario",
    community_time_morning: "Mattina",
    community_time_afternoon: "Pomeriggio",
    community_time_night: "Sera / notte",
    community_time_morning_range: "Mattina (6–12)",
    community_time_afternoon_range: "Pomeriggio (12–20)",
    community_time_night_range: "Sera / notte (20–6)",
    community_no_events_for_filters:
      "Non ci sono eventi per questa data/orario.",

    /* ---------- Verification flow ---------- */
    verification_pre_title: "Verificati",
    verification_pre_body:
      "Per mantenere la Community autentica, chiediamo a tutti gli utenti di fare una breve verifica facciale prima di interagire con gli altri.",
    verification_pre_button_start: "Inizia",
    verification_pre_button_upload: "Carica foto profilo",

    verification_face_title: "Verifica facciale",
    verification_face_body:
      "Confronteremo il tuo volto da diverse angolazioni con la foto profilo per confermare che sei davvero tu.",
    verification_face_button_dev_complete: "Ho finito – segnami verificato",

    avatar_invalid_title: "Foto profilo",
    avatar_invalid_message:
      "Carica una foto profilo in cui il tuo volto sia ben visibile.",

    /* ---------- Chat / blocking ---------- */
    chat_user_blocked_snippet: "Utente bloccato.",
    chat_single_blocked_body:
      "Questo utente è bloccato. Per vedere i suoi messaggi devi sbloccarlo.",
    chat_single_unblock_cta: "Sblocca",
    chat_single_unblock_confirm_title:
      "Sei sicuro di voler sbloccare questo utente?",
    chat_single_unblock_confirm_no: "No",
    chat_single_unblock_confirm_yes: "Sì",

    group_message_member: 'Invia un messaggio',
    group_make_admin: 'Rendere amministratore',
    group_remove_member: 'Rimuovi questo utente',
    cancel: 'Annullare',
    group_subgroups_title: 'Sottogruppi',
    group_members_title: 'Membri',
    group_add_subgroup_button: 'Aggiungere sottogruppo',
    group_invite_user_button: 'Invitare utenti',
    group_new_subgroup_placeholder: 'Nuovo sottogruppo',

    create_post_post_type_feed: 'Post Feed',
    chat_search_people_title: 'Utenti',
    chat_search_message_button: 'Invia',
    loading_text: 'Caricamento',

    signup_name_placeholder: 'Nome Cognome',
    signup_email_placeholder: 'Email',
    signup_username_placeholder: 'nomeutente',
    signup_password_placeholder: 'Password',
    signup_age_placeholder: 'Età',
    signup_age_picker_title: 'Età',
    signup_picker_done: 'Fatto',
    signup_gender_placeholder: 'Genere',
    signup_gender_picker_title: 'Genere',
    signup_city_placeholder: 'Città',
    signup_button_label: 'Iscriviti',

    chat_search_no_matching_users: 'Nessun utente corrispondente.',

        // ✅ Community area slider
    settings_area_title: "Seleziona area Community",
    settings_area_helper:
      "Vedrai solo eventi, utenti e annunci entro questa distanza dalla tua posizione",
    settings_meters: "metri",

    // ✅ EventSettings / AdSettings labels
    event_settings_tags_title: "Quali eventi vuoi vedere?",
    event_settings_tags_placeholder: "Concerti, sport, arrampicata, ecc.",
    ad_settings_tags_title: "Quali annunci vuoi vedere?",
    ad_settings_tags_placeholder: "Cibo vicino a Piola, mercatini vintage",

    signup_have_account_prefix: "Hai già un account?",
    login_button_label: 'Accedi',

    event_settings_title: 'Impostazioni Evento',
    edit_event_post: 'Modifica post evento',
    change_date_time: 'Modifica data e ora',
    ticket_holders: 'Biglietto comprato',
    unconfirmed: 'Non confermati',
    dm_whole_list: 'Messaggia intera lista',
    invite_previous_event: 'invitare utenti da evento precedente',
    invite_users: 'Invitare utenti',
    delete_event: 'Elimina evento',
    change_location: "Cambiare ubicazione",    
    not_on_alba_yet: "non usa Alba",

    past_events: "Eventi passati",
    delete_event_confirm: "Vuoi eliminare quest'evento?",
    remove_user_confirm: "Vuoi rimuovere quest'utente?",
    open_attendees_list: "Aprire lista di partecipanti",
    close_attendees_list: "Chiudere lista di partecipanti",
    select_all: 'Selezionare tutti',
    invite: 'Invitare',    
    invite_default_message: "andiamo a questo evento?",

    my_tickets_title: 'I miei biglietti',
    no_qr_found: 'Nessun biglietto QR trovato per questo evento.',

    /* ---------- Follow / ProfileScreen ---------- */
    profile_follow: "Segui",
    profile_following: "Stai seguendo",
    profile_blocked_label: "Bloccato",
    profile_message_button: "Messaggio",
    profile_report_label: "Segnala",
    profile_block_label: "Blocca",
    profile_unblock_label: "Sblocca",
    profile_cancel_label: "Annulla",
    profile_report_user_title: "Segnala utente",
    profile_report_placeholder: "Descrivi il problema...",
    profile_thanks_report: "Grazie per la segnalazione.",
    profile_bio_add: "Aggiungi una bio...",
    profile_bio_read_more: "Mostra altro",
    profile_bio_save: "Salva",
    profile_bio_saving: "Salvataggio...",
    profile_couldnt_save_bio: "Impossibile salvare la bio.",
    profile_no_posts: "non ha ancora pubblicato post.",

    /* ---------- CommunitySettings – General tab ---------- */
    settings_profile_section: "Profilo",
    settings_verified: "Verificato",
    settings_not_verified: "Non verificato — tocca per verificarti e sbloccare post & chat",
    settings_name_placeholder: "Nome",
    settings_username_placeholder: "Username",
    settings_checking_username: "Controllo disponibilità…",
    settings_username_available: "Disponibile",
    settings_username_taken: "Non disponibile",
    settings_username_invalid: "Minimo 3 caratteri",
    settings_password_placeholder: "Nuova password (lascia vuoto per non cambiare)",
    settings_confirm_password: "Conferma nuova password",
    settings_save_changes: "Salva modifiche",
    settings_saved: "Salvato!",
    settings_blocked_users_title: "Utenti bloccati",
    settings_no_blocked: "Non hai bloccato nessuno.",
    show_followed_posts: "Mostra post degli utenti che segui",

    /* ---------- Feed screen ---------- */
    feed_loading: "Caricamento video…",
    feed_no_videos: "Nessun video",
    feed_report_menu: "Segnala",
    feed_block_menu: "Blocca utente",
    feed_delete_menu: "Elimina",
    feed_report_title: "Perché vuoi segnalare questo utente?",
    feed_report_placeholder: "Descrivi il problema...",
    feed_block_title: "Sei sicuro di voler bloccare questo utente?",
    feed_delete_title: "Sei sicuro di voler eliminare questo post?",
    feed_blocked_toast: "Hai bloccato questo utente.",
    feed_reported_toast: "Hai segnalato questo utente.",
    feed_break_title: "Prenditi una pausa!",
    feed_break_message: "Hai guardato per {n} minuto/i.",
    ok_button: "OK",
    feed_couldnt_delete: "Impossibile eliminare il post.",
    feed_deleted_toast: "Post eliminato.",

    /* ---------- FeedSettings screen ---------- */
    feed_settings_title: "Impostazioni Feed",
    feed_settings_timer_title: "Mostra timer di utilizzo",
    feed_settings_timer_sub: "Mostra un timer sul Feed che indica quanto stai guardando",
    feed_settings_alert_title: "Avvisami dopo",
    feed_settings_minutes: "minuti",
    feed_settings_hint: "Quando il timer raggiunge il limite, riceverai un promemoria per fare una pausa.",
    feed_settings_saved_videos: "Vedi i miei video salvati",

    /* ---------- Saved Videos screen ---------- */
    saved_videos_title: "Video salvati",
    saved_videos_empty: "Nessun video salvato",

    /* ---------- Post / caption ---------- */
    caption_read_less: "Mostra meno",

    /* ---------- Chats screen ---------- */
    chats_title: "Chat",

    /* ---------- CreatePost – publish button ---------- */
    create_post_publish_button: "Pubblica",

    /* ---------- MyEvents ---------- */
    my_events_chat: "Chat evento",
    my_events_settings: "Impostazioni",

    /* ---------- MyAds ---------- */
    my_ads_settings: "Impostazioni annuncio",

    /* ---------- CommunitySettings – Premium section ---------- */
    premium_section_title: "Alba Premium",
    premium_ad_free_label: "Senza pubblicità",
    premium_ad_free_sub: "Naviga la Community senza pubblicità — €5,00/mese",
    premium_traveler_label: "Modalità Viaggiatore",
    premium_traveler_sub: "Accedi alla Community in qualsiasi città — €4,99/mese",
    premium_traveler_city_placeholder: "Cerca una città...",
    premium_traveler_browsing: "Stai navigando come: {city}",
    premium_traveler_no_city: "Nessuna città selezionata — userà la tua posizione reale",
    premium_diffusion_label: "Lista Diffusione",
    premium_diffusion_sub: "Trasmetti un messaggio agli utenti Alba vicini — €1,00 per messaggio",
    premium_broadcast_radius: "Raggio di trasmissione",
    premium_radius_hint: "Min 1 {unit} · Max 50 {unit}",
    premium_reach_users: "Il tuo messaggio raggiungerà circa {n} utenti",

    /* ---------- CommunitySettings – Notifications ---------- */
    notif_section_title: "Notifiche",
    notif_direct_messages: "Messaggi Diretti",
    notif_direct_messages_sub: "Avvisa quando ricevi un messaggio diretto",
    notif_group_messages: "Messaggi di Gruppo",
    notif_group_messages_sub: "Avvisa quando qualcuno invia un messaggio nel gruppo",
    notif_diffusion: "Messaggi Diffusione",
    notif_diffusion_sub: "Avvisa quando ricevi un messaggio broadcast",
    notif_followed_posts: "Post degli account seguiti",
    notif_followed_posts_sub: "Avvisa quando gli account seguiti creano un post",

    /* ---------- CommunitySettings – Logout / Delete ---------- */
    logout_title: "Esci",
    logout_confirm: "Sei sicuro di voler uscire?",
    settings_logout: "Esci",
    settings_delete_account: "Elimina account",
    settings_delete_title: "Eliminare il tuo account?",
    settings_delete_body: "Questo elimina definitivamente il tuo profilo, i post e tutti i dati. Non è reversibile.",
    settings_delete_confirm: "Elimina",

    /* ---------- Ticket & Ad payout sections ---------- */
    payout_ticket_title: "Pagamenti biglietti",
    payout_ticket_no_event: "Se organizzi eventi e vendi biglietti su Alba, puoi collegare un conto bancario qui per ricevere i proventi direttamente. Prima crea un evento.",
    payout_ticket_connected: "Il tuo conto bancario è collegato. Le vendite di biglietti ti verranno trasferite automaticamente, meno una piccola commissione.",
    payout_ticket_pending: "Registrazione avviata — completa la verifica su Stripe per ricevere i pagamenti.",
    payout_ticket_not_setup: "Collega un conto bancario per ricevere i proventi direttamente. Alba trattiene una piccola commissione per transazione; il resto va a te.",
    payout_product_title: "Pagamenti vendite prodotti",
    payout_product_connected: "Il tuo conto bancario è collegato. I pagamenti dalle vendite di prodotti ti verranno trasferiti automaticamente, meno una piccola commissione.",
    payout_product_pending: "Registrazione avviata — completa la verifica su Stripe per ricevere i pagamenti.",
    payout_product_not_setup: "Se vendi prodotti tramite i tuoi annunci su Alba, collega un conto bancario qui. Alba trattiene una piccola commissione; il resto va a te.",
    payout_status_connected: "Connesso",
    payout_status_pending: "Verifica in corso",
    payout_status_not_setup: "Non configurato",
    payout_continue_setup: "Continua configurazione",
    payout_setup: "Configura pagamenti",
    payout_reset_event: "Ripristina impostazioni eventi",
    payout_reset_ad: "Ripristina impostazioni annunci",
    payout_instructions_label: "Istruzioni",
    payout_instructions_helper: "Non sai come configurare i pagamenti? Consulta le istruzioni sul nostro sito",

    /* ---------- Ad Dashboard (AdPublisherScreen) ---------- */
    ad_dashboard_title: "Dashboard Annunci",
    ad_tab_overview: "Panoramica",
    ad_tab_performance: "Performance",
    ad_tab_my_ads: "I miei Annunci",
    ad_tab_buyers: "Acquirenti",
    ad_all_campaigns: "TUTTE LE CAMPAGNE",
    ad_stat_buy_rate: "Tasso acquisto",
    ad_stat_message_rate: "Tasso messaggi",
    ad_stat_total_results: "Risultati totali",
    ad_active: "attivo",
    ad_see_all: "Vedi tutti gli {n} annunci →",
    ad_create_new: "Crea nuovo annuncio",
    ad_create_first: "Crea il primo annuncio",
    ad_loading: "Caricamento annunci…",
    ad_untitled: "Annuncio senza titolo",
    ad_no_date: "Nessuna data",
    ad_your_ads: "I TUOI ANNUNCI",
    ad_viewing_ad: "ANNUNCIO SELEZIONATO",
    ad_select_ad: "Seleziona un annuncio",
    ad_results_label: "RISULTATI",
    ad_buy_rate_hint: "Visualizzatori che hanno acquistato",
    ad_msg_rate_label: "Tasso messaggi",
    ad_msg_rate_hint: "Visualizzatori che hanno scritto",
    ad_cost_per_sale: "Costo per vendita",
    ad_cost_per_sale_hint: "Spesa ÷ acquisti",
    ad_cost_per_inquiry: "Costo per contatto",
    ad_cost_per_inquiry_hint: "Spesa ÷ messaggi",
    ad_locked_cost: "Le metriche di costo si sbloccheranno quando aggiungerai il tracciamento del budget.",
    ad_compare_all: "CONFRONTA TUTTI GLI ANNUNCI",
    ad_purchases: "Acquisti",
    ad_inquiries: "Contatti",
    ad_chart_no_data: "Nessun dato — si aggiornerà quando le persone interagiranno con i tuoi annunci.",
    ad_buy_rate_short: "tasso acquisto",
    ad_msg_rate_short: "tasso msg",
    ad_results_short: "risultati",
    ad_details: "Dettagli →",
    ad_no_performance_title: "Nessun dato di performance",
    ad_no_performance_body: "Crea il tuo primo annuncio per iniziare a monitorare visualizzazioni, acquisti e contatti.",
    ad_no_ads_title: "Nessun annuncio",
    ad_no_ads_body: "Crea la tua prima campagna per raggiungere i locali nella tua zona.",
    ad_edit_title: "Modifica annuncio",
    ad_title_label: "Titolo",
    ad_description_label: "Descrizione",
    ad_date_label: "Data",
    ad_time_label: "Orario",
    ad_location_label: "Posizione",
    ad_save_changes: "Salva modifiche",
    ad_delete_title: "Eliminare questo annuncio?",
    ad_delete_body: "Questo rimuoverà definitivamente l'annuncio e tutte le sue statistiche. Non è reversibile.",
    ad_delete_confirm: "Elimina",
    ad_cancel: "Annulla",
    ad_error_save: "Impossibile salvare le modifiche.",
    ad_error_delete: "Impossibile eliminare l'annuncio.",
    ad_summary_one: "Hai 1 annuncio attivo",
    ad_summary_many: "Hai {n} annunci attivi",
    ad_info_overview: "Su Alba, i tuoi annunci raggiungono persone reali vicino a te che hanno optato — non estranei anonimi. Meno impressioni, intenzione molto più alta.",
    ad_info_performance: "Su Alba, gli annunci raggiungono utenti iscritti nelle vicinanze — non tutta internet. Aspettati numeri più bassi ma intenzione e rilevanza significativamente più alte.",

    /* ---------- UseTimeScreen ---------- */
    usetime_title: "Tempo Schermo",
    usetime_allow_track: "Permetti ad Alba di monitorare il tuo tempo sui social",
    usetime_ios_android: "Usiamo il framework Screen Time di Apple su iOS\ne Accesso utilizzo su Android.\nI tuoi dati non lasciano mai il dispositivo.",
    usetime_enable: "Attiva Screen Time",
    usetime_observation_title: "Periodo di osservazione",
    usetime_observation_days: "Alba sta imparando le tue abitudini. Ancora {n} g per impostare il tuo obiettivo personalizzato.",
    usetime_observation_computing: "Calcolo della baseline della prima settimana…",
    usetime_no_data: "Nessun dato",
    usetime_social_today: "Tempo social media oggi",
    usetime_social_week: "Tempo social media questa settimana",
    usetime_tracking_active: "Monitoraggio attivo",
    usetime_tracking_paused: "Monitoraggio in pausa",
    usetime_tap_deactivate: "Tocca per disattivare",
    usetime_tap_reenable: "Tocca per riattivare",
    usetime_my_goals: "I miei obiettivi:",
    usetime_reduction_pct: "{n}% di riduzione a settimana",
    usetime_change: "Modifica",
    usetime_weekly_goal_title: "Obiettivo riduzione settimanale",
    usetime_per_week: "% a settimana",
    usetime_daily_max_title: "Massimo giornaliero",
    usetime_steps_hint: "30 min – 8 ore, in passi da 15 minuti",
    usetime_pause_title: "Mettere in pausa?",
    usetime_pause_sub: "Dicci perché vuoi smettere — ci aiuta a migliorare Alba.",
    usetime_reason_accomplished: "Ho già raggiunto il mio obiettivo",
    usetime_reason_no_longer: "Non voglio più ridurre il tempo schermo",
    usetime_reason_other: "Altro",
    usetime_other_placeholder: "Dicci di più…",
    usetime_confirm: "Conferma",
    usetime_building_habits: "Costruendo buone abitudini 🎯",
    usetime_on_fire: "Sei in forma! 🔥",
    usetime_keep_streak: "Continua la striscia! 💚",
    usetime_back_on_track: "Torniamo in carreggiata 💪",
    usetime_good_recovery: "Buona ripresa! Vai avanti 💪",
    usetime_making_progress: "Stai facendo progressi! 🎯",
    usetime_below_label: "Sei {pct}% sotto {label}",
    usetime_above_label: "Sei {pct}% sopra {label}",
    usetime_same_as: "Uguale a {label}",
    usetime_from_goal: "Sei a {time} dal tuo obiettivo giornaliero",
    usetime_over_goal: "Sei {time} sopra il tuo obiettivo",
    usetime_hit_goal: "Hai raggiunto esattamente il tuo obiettivo",
    usetime_less_than_h: "Meno di {h}h al giorno",
    usetime_less_than_hm: "Meno di {h}h {m}min al giorno",
    usetime_yesterday: "ieri",
    usetime_last_day: "{day} scorso",

    /* ---------- GroupInfoScreen ---------- */
    group_subgroup_see: "Vedi",
    group_subgroup_join: "Unisciti",
    group_meta: "Gruppo · {n} membro",
    group_meta_plural: "Gruppo · {n} membri",
    group_require_approval: "Richiedi approvazione per unirsi",
    group_require_approval_sub: "I nuovi membri devono essere approvati da un admin",
    group_review_links: "Esamina messaggi con link",
    group_review_links_sub: "I membri vengono avvisati quando inviano messaggi con link",
    group_pending_requests: "Richieste in attesa ({n})",
    group_approve: "Approva",
    group_decline: "Rifiuta",
    group_remove_admin: "Rimuovi admin",
  }
};

const LanguageContext = createContext({
  language: "en",
  setLanguage: () => {},
  t: (key) => key,
});

function detectDeviceLanguage() {
  try {
    const locales = Localization.getLocales?.() || [];
    const code = (locales[0]?.languageCode || "").toLowerCase();
    return code === "it" ? "it" : "en";
  } catch {
    return "en";
  }
}

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState("en");

  // Load from storage on mount; if none, use device language
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);

        if (!mounted) return;

        if (stored === "en" || stored === "it") {
          setLanguageState(stored);
          return;
        }

        const deviceLang = detectDeviceLanguage();
        setLanguageState(deviceLang);
        AsyncStorage.setItem(STORAGE_KEY, deviceLang).catch(() => {});
      } catch (e) {
        console.warn("Language load error", e);
        const deviceLang = detectDeviceLanguage();
        if (mounted) setLanguageState(deviceLang);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  // Persist whenever language changes
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, language).catch((e) =>
      console.warn("Language save error", e)
    );
  }, [language]);

  const setLanguage = (next) => {
    if (next === "en" || next === "it") setLanguageState(next);
  };

  const t = (key) => STRINGS[language]?.[key] || STRINGS.en?.[key] || key || "";

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useAlbaLanguage = () => useContext(LanguageContext);