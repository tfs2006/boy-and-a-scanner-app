import { supabase } from './supabaseClient';
import { CommunityPost, PostComment, CommunityEvent, PostCategory } from '../types';

// ---------------------------------------------------------------------------
// Input limits — enforced here and mirrored in DB CHECK constraints
// ---------------------------------------------------------------------------
const MAX_TITLE_LEN   = 150;
const MAX_BODY_LEN    = 5000;
const MAX_COMMENT_LEN = 1000;

/** Strip angle brackets to prevent HTML injection, then trim to max length. */
function safeTrim(text: string, maxLen: number): string {
  return text.replace(/[<>]/g, '').slice(0, maxLen).trim();
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function getPosts(
  category: PostCategory | 'all' = 'all',
  limit = 50,
): Promise<CommunityPost[]> {
  if (!supabase) return [];

  let query = supabase
    .from('community_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category !== 'all') {
    query = query.eq('category', category);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  // Determine which posts the current user has upvoted
  const { data: { user } } = await supabase.auth.getUser();
  let upvotedIds = new Set<string>();
  if (user && data.length > 0) {
    const { data: upvotes } = await supabase
      .from('post_upvotes')
      .select('post_id')
      .eq('user_id', user.id)
      .in('post_id', data.map((p: CommunityPost) => p.id));
    if (upvotes) upvotedIds = new Set(upvotes.map((u: { post_id: string }) => u.post_id));
  }

  // Count comments per post in a single query
  const commentCounts: Record<string, number> = {};
  if (data.length > 0) {
    const { data: allComments } = await supabase
      .from('post_comments')
      .select('post_id')
      .in('post_id', data.map((p: CommunityPost) => p.id));
    if (allComments) {
      for (const c of allComments as { post_id: string }[]) {
        commentCounts[c.post_id] = (commentCounts[c.post_id] ?? 0) + 1;
      }
    }
  }

  return (data as CommunityPost[]).map(p => ({
    ...p,
    user_has_upvoted: upvotedIds.has(p.id),
    comment_count: commentCounts[p.id] ?? 0,
  }));
}

export async function createPost(
  category: PostCategory,
  title: string,
  body: string,
): Promise<CommunityPost | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Fetch current username for denormalization
  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('user_id', user.id)
    .maybeSingle();

  const cleanTitle = safeTrim(title, MAX_TITLE_LEN);
  const cleanBody  = safeTrim(body,  MAX_BODY_LEN);
  if (cleanTitle.length < 3 || cleanBody.length < 10) return null;

  const { data, error } = await supabase
    .from('community_posts')
    .insert({
      user_id:         user.id,
      author_username: profile?.username ?? 'Anonymous',
      category,
      title:           cleanTitle,
      body:            cleanBody,
    })
    .select()
    .single();

  if (error || !data) return null;
  return { ...(data as CommunityPost), user_has_upvoted: false, comment_count: 0 };
}

/**
 * Toggle an upvote on a post. The DB trigger keeps `community_posts.upvotes`
 * in sync, so we just insert / delete the pivot row and re-fetch the count.
 */
export async function toggleUpvote(
  postId: string,
  currentlyUpvoted: boolean,
): Promise<{ upvotes: number; user_has_upvoted: boolean } | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (currentlyUpvoted) {
    await supabase
      .from('post_upvotes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);
  } else {
    await supabase
      .from('post_upvotes')
      .insert({ post_id: postId, user_id: user.id });
  }

  // Re-fetch authoritative count after trigger fires
  const { data } = await supabase
    .from('community_posts')
    .select('upvotes')
    .eq('id', postId)
    .single();

  return {
    upvotes:          (data as { upvotes: number } | null)?.upvotes ?? 0,
    user_has_upvoted: !currentlyUpvoted,
  };
}

export async function deletePost(postId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('community_posts').delete().eq('id', postId);
  return !error;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function getComments(postId: string): Promise<PostComment[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('post_comments')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error || !data) return [];
  return data as PostComment[];
}

export async function addComment(
  postId: string,
  body: string,
): Promise<PostComment | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('username')
    .eq('user_id', user.id)
    .maybeSingle();

  const cleanBody = safeTrim(body, MAX_COMMENT_LEN);
  if (!cleanBody) return null;

  const { data, error } = await supabase
    .from('post_comments')
    .insert({
      post_id:         postId,
      user_id:         user.id,
      author_username: profile?.username ?? 'Anonymous',
      body:            cleanBody,
    })
    .select()
    .single();

  if (error || !data) return null;
  return data as PostComment;
}

export async function deleteComment(commentId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId);
  return !error;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export async function getEvents(): Promise<CommunityEvent[]> {
  if (!supabase) return [];

  // Only show events from today forward
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  return data as CommunityEvent[];
}
