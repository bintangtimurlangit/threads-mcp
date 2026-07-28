// ─── Threads GraphQL shapes (subset we read) ──────────────────────────────────
//
// Threads' Relay gateway returns deeply-nested JSON that varies per query. These
// types model the *common* leaf objects — a `post` and a `user` — plus loose
// wrappers. Tools dig into responses defensively (see extractors in tools/read).
// Fields are optional because the gateway trims them per surface.

export interface ThreadsUser {
  pk?: string;
  id?: string;
  username?: string;
  full_name?: string;
  biography?: string;
  follower_count?: number;
  following_count?: number;
  is_verified?: boolean;
  profile_pic_url?: string;
  hd_profile_pic_url_info?: { url?: string };
}

export interface TextPostAppInfo {
  direct_reply_count?: number;
  reply_count?: number;
  reposts_count?: number;
  quote_count?: number;
  is_reply?: boolean;
  reply_to_author?: { username?: string };
  link_preview_attachment?: { url?: string; title?: string } | null;
  /**
   * A post embedded in this one. `extractPosts` deliberately does not surface
   * these as separate feed entries (they belong to the containing post), so
   * rendering reads them from here instead.
   */
  share_info?: {
    quoted_post?: ThreadsPost | null;
    reposted_post?: ThreadsPost | null;
  } | null;
}

export interface ThreadsPost {
  pk?: string;
  id?: string;
  code?: string;
  taken_at?: number;
  like_count?: number;
  caption?: { text?: string } | null;
  user?: ThreadsUser;
  text_post_app_info?: TextPostAppInfo;
  image_versions2?: { candidates?: Array<{ url?: string; width?: number; height?: number }> };
  video_versions?: Array<{ url?: string }>;
  has_liked?: boolean;
}

/**
 * An entry in the Activity feed, as Threads ships it (`XDTActivityFeedStory`).
 *
 * The display string lives in `args.extra.context` ("Followed you", "Because
 * you follow"), the actor in `args.profile_name`, and the target in
 * `args.destination` — either `user?id=…&username=…` or
 * `media?id=…&shortcode=…`.
 */
export interface ActivityStory {
  __typename?: string;
  story_type?: number;
  args?: {
    tuuid?: string;
    timestamp?: number;
    profile_name?: string;
    destination?: string | null;
    profile_image?: string | null;
    extra?: {
      context?: string;
      content?: string;
      icon_name?: string;
      title?: string;
    } | null;
  };
}

/** One item within a thread (a root post or a reply in the chain). */
export interface ThreadItem {
  post?: ThreadsPost;
  line_type?: string;
  should_show_replies_cta?: boolean;
}

/** A "thread" grouping (root post + its inline reply chain). */
export interface ThreadNode {
  id?: string;
  thread_items?: ThreadItem[];
}

/** Generic edge/paging wrapper Threads uses in several queries. */
export interface PageInfo {
  has_next_page?: boolean;
  end_cursor?: string | null;
}

/**
 * A permissive top-level GraphQL envelope. Different friendly-named queries put
 * their payload under different keys of `data`, so we keep it open and let
 * extractors walk it.
 */
export interface GraphqlEnvelope {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message?: string }>;
  status?: string;
  message?: string;
}
