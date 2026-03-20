import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageCircle, Users, Calendar, BookOpen, Plus, ThumbsUp, Trash2,
  Send, ExternalLink, ChevronLeft, Loader2, MapPin, Clock, Tag,
  Wrench, Radio, Scale, RefreshCw, Hash, Lightbulb, Star,
  HeartHandshake, ShoppingBag, Mic, AlertCircle,
} from 'lucide-react';
import { CommunityPost, PostComment, CommunityEvent, PostCategory } from '../types';
import {
  getPosts, createPost, toggleUpvote, deletePost,
  getComments, addComment, deleteComment, getEvents,
} from '../services/communityService';
import { Session } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SubView = 'forum' | 'events' | 'tips';
type ActiveCategory = PostCategory | 'all';

const CATEGORY_CONFIG: Record<ActiveCategory, { label: string; color: string; Icon: React.ElementType }> = {
  all:         { label: 'All Topics',     color: 'text-slate-300',  Icon: Hash },
  equipment:   { label: 'Equipment',      color: 'text-cyan-400',   Icon: Wrench },
  frequencies: { label: 'Frequencies',   color: 'text-emerald-400', Icon: Radio },
  events:      { label: 'Events',         color: 'text-amber-400',  Icon: Calendar },
  legal:       { label: 'Legal & Ethics', color: 'text-rose-400',   Icon: Scale },
  general:     { label: 'General',        color: 'text-purple-400', Icon: MessageCircle },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  convention: '🏛️ Convention',
  meetup:     '🤝 Meetup',
  online:     '💻 Online',
  swap_meet:  '🛒 Swap Meet',
  other:      '📅 Other',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatEventDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// PostCard
// ---------------------------------------------------------------------------

interface PostCardProps {
  post: CommunityPost;
  currentUserId?: string;
  onClick: () => void;
  onUpvote: (postId: string, current: boolean) => void;
  onDelete: (postId: string) => void;
}

const PostCard: React.FC<PostCardProps> = ({ post, currentUserId, onClick, onUpvote, onDelete }) => {
  const cfg = CATEGORY_CONFIG[post.category];
  const { Icon } = cfg;

  return (
    <div
      className="group bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 cursor-pointer transition-all duration-150 animate-fade-in"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Upvote column */}
        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
          <button
            onClick={e => { e.stopPropagation(); onUpvote(post.id, !!post.user_has_upvoted); }}
            className={`p-1.5 rounded-lg transition-colors ${
              post.user_has_upvoted
                ? 'bg-cyan-900/40 text-cyan-400'
                : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'
            }`}
            title={post.user_has_upvoted ? 'Remove upvote' : 'Upvote'}
          >
            <ThumbsUp className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono-tech text-slate-400">{post.upvotes}</span>
        </div>

        {/* Post content */}
        <div className="flex-1 min-w-0">
          {/* Category tag */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`inline-flex items-center gap-1 text-[10px] font-mono-tech font-bold uppercase tracking-wider ${cfg.color}`}>
              <Icon className="w-3 h-3" />
              {cfg.label}
            </span>
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-white group-hover:text-cyan-300 transition-colors leading-snug mb-1.5">
            {post.title}
          </h3>

          {/* Preview */}
          <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-2">
            {post.body}
          </p>

          {/* Footer meta */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono-tech">
              <span className="text-slate-400">{post.author_username}</span>
              <span>{timeAgo(post.created_at)}</span>
              <span className="flex items-center gap-0.5">
                <MessageCircle className="w-3 h-3" />
                {post.comment_count ?? 0}
              </span>
            </div>
            {currentUserId === post.user_id && (
              <button
                onClick={e => { e.stopPropagation(); onDelete(post.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-red-400 transition-all rounded"
                title="Delete post"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// CreatePostModal
// ---------------------------------------------------------------------------

interface CreatePostModalProps {
  onClose: () => void;
  onCreated: (post: CommunityPost) => void;
}

const CreatePostModal: React.FC<CreatePostModalProps> = ({ onClose, onCreated }) => {
  const [category, setCategory] = useState<PostCategory>('general');
  const [title, setTitle]       = useState('');
  const [body, setBody]         = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3)  { setError('Title must be at least 3 characters.'); return; }
    if (body.trim().length < 10)  { setError('Post body must be at least 10 characters.'); return; }
    setSaving(true);
    setError(null);
    const post = await createPost(category, title, body);
    setSaving(false);
    if (!post) { setError('Failed to create post. Please try again.'); return; }
    onCreated(post);
  };

  const categories = Object.entries(CATEGORY_CONFIG).filter(([k]) => k !== 'all') as
    [PostCategory, typeof CATEGORY_CONFIG['general']][];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#0f182a] border border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-bold text-white font-mono-tech uppercase tracking-wider mb-4">
          New Discussion Post
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Category */}
          <div>
            <label className="block text-xs text-slate-400 font-mono-tech mb-1.5 uppercase tracking-wider">
              Category
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {categories.map(([key, cfg]) => {
                const { Icon } = cfg;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCategory(key)}
                    className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-mono-tech font-bold border transition-colors ${
                      category === key
                        ? `${cfg.color} bg-slate-800 border-current`
                        : 'text-slate-500 border-slate-700 hover:border-slate-600 hover:text-slate-300'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase tracking-wider">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={150}
              placeholder="What's your post about?"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-600 focus:outline-none transition-colors"
              required
            />
            <div className="text-right text-[10px] text-slate-600 mt-0.5">{title.length}/150</div>
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs text-slate-400 font-mono-tech mb-1 uppercase tracking-wider">
              Body
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={5000}
              rows={6}
              placeholder="Share your thoughts, questions, or findings..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-600 focus:outline-none transition-colors resize-none"
              required
            />
            <div className="text-right text-[10px] text-slate-600 -mt-0.5">{body.length}/5000</div>
          </div>

          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg text-sm font-mono-tech font-bold border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2 rounded-lg text-sm font-mono-tech font-bold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white transition-colors flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {saving ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// PostDetailModal
// ---------------------------------------------------------------------------

interface PostDetailProps {
  post: CommunityPost;
  currentUserId?: string;
  onClose: () => void;
  onUpvote: (postId: string, current: boolean) => void;
  onDelete: (postId: string) => void;
}

const PostDetailModal: React.FC<PostDetailProps> = ({
  post, currentUserId, onClose, onUpvote, onDelete,
}) => {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const cfg = CATEGORY_CONFIG[post.category];
  const { Icon } = cfg;

  useEffect(() => {
    getComments(post.id).then(data => {
      setComments(data);
      setLoadingComments(false);
    });
  }, [post.id]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    setSubmitting(true);
    const newComment = await addComment(post.id, commentText);
    setSubmitting(false);
    if (newComment) {
      setComments(prev => [...prev, newComment]);
      setCommentText('');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const ok = await deleteComment(commentId);
    if (ok) setComments(prev => prev.filter(c => c.id !== commentId));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-[#0f182a] border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className={`inline-flex items-center gap-1 text-[10px] font-mono-tech font-bold uppercase tracking-wider ${cfg.color}`}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </span>
        </div>

        {/* Body (scrollable) */}
        <div className="flex-1 overflow-y-auto">
          {/* Post */}
          <div className="px-5 py-4 border-b border-slate-800">
            <h2 className="text-base font-bold text-white leading-snug mb-3">{post.title}</h2>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{post.body}</p>

            <div className="flex items-center justify-between mt-4">
              <div className="flex items-center gap-3 text-xs text-slate-500 font-mono-tech">
                <span className="text-slate-400">{post.author_username}</span>
                <span>{timeAgo(post.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                {currentUserId === post.user_id && (
                  <button
                    onClick={() => { onDelete(post.id); onClose(); }}
                    className="p-1.5 text-slate-600 hover:text-red-400 transition-colors rounded-lg hover:bg-slate-800"
                    title="Delete post"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onUpvote(post.id, !!post.user_has_upvoted)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono-tech font-bold border transition-colors ${
                    post.user_has_upvoted
                      ? 'bg-cyan-900/40 border-cyan-700/50 text-cyan-400'
                      : 'border-slate-700 text-slate-400 hover:border-cyan-700/50 hover:text-cyan-400'
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {post.upvotes} {post.upvotes === 1 ? 'upvote' : 'upvotes'}
                </button>
              </div>
            </div>
          </div>

          {/* Comments */}
          <div className="px-5 py-4">
            <h3 className="text-xs font-mono-tech uppercase tracking-wider text-slate-500 mb-3">
              Comments ({comments.length})
            </h3>

            {loadingComments ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-slate-600" />
              </div>
            ) : comments.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-4">
                No comments yet — be the first to reply.
              </p>
            ) : (
              <div className="space-y-3">
                {comments.map(c => (
                  <div key={c.id} className="group bg-slate-800/50 rounded-lg px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-slate-300 leading-relaxed flex-1 whitespace-pre-wrap">
                        {c.body}
                      </p>
                      {currentUserId === c.user_id && (
                        <button
                          onClick={() => handleDeleteComment(c.id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-red-400 transition-all rounded"
                          title="Delete comment"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500 font-mono-tech">
                      <span className="text-slate-400">{c.author_username}</span>
                      <span>{timeAgo(c.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Comment input (pinned at bottom) */}
        {currentUserId && (
          <form
            onSubmit={handleAddComment}
            className="px-5 py-3 border-t border-slate-800 flex items-center gap-2 shrink-0"
          >
            <input
              type="text"
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              maxLength={1000}
              placeholder="Add a reply…"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-600 focus:outline-none transition-colors"
            />
            <button
              type="submit"
              disabled={submitting || !commentText.trim()}
              className="p-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white transition-colors"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ForumView
// ---------------------------------------------------------------------------

interface ForumViewProps {
  currentUserId?: string;
}

const ForumView: React.FC<ForumViewProps> = ({ currentUserId }) => {
  const [activeCategory, setActiveCategory] = useState<ActiveCategory>('all');
  const [posts, setPosts]                   = useState<CommunityPost[]>([]);
  const [loading, setLoading]               = useState(true);
  const [showCreate, setShowCreate]         = useState(false);
  const [activePost, setActivePost]         = useState<CommunityPost | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getPosts(activeCategory);
    setPosts(data);
    setLoading(false);
  }, [activeCategory]);

  useEffect(() => { load(); }, [load]);

  const handleUpvote = async (postId: string, current: boolean) => {
    if (!currentUserId) return;
    const result = await toggleUpvote(postId, current);
    if (!result) return;
    setPosts(prev => prev.map(p =>
      p.id === postId ? { ...p, upvotes: result.upvotes, user_has_upvoted: result.user_has_upvoted } : p
    ));
    if (activePost?.id === postId) {
      setActivePost(prev => prev ? { ...prev, upvotes: result.upvotes, user_has_upvoted: result.user_has_upvoted } : prev);
    }
  };

  const handleDelete = async (postId: string) => {
    const ok = await deletePost(postId);
    if (ok) {
      setPosts(prev => prev.filter(p => p.id !== postId));
      if (activePost?.id === postId) setActivePost(null);
    }
  };

  const categoryList = Object.entries(CATEGORY_CONFIG) as [ActiveCategory, typeof CATEGORY_CONFIG['all']][];

  return (
    <>
      {/* Category filter tabs */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {categoryList.map(([key, cfg]) => {
          const { Icon } = cfg;
          return (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-mono-tech font-bold border transition-colors ${
                activeCategory === key
                  ? `${cfg.color} bg-slate-800 border-slate-600`
                  : 'text-slate-500 border-slate-800 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <Icon className="w-3 h-3" />
              {cfg.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-500 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {currentUserId && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono-tech font-bold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Post
            </button>
          )}
        </div>
      </div>

      {/* Post list */}
      {loading ? (
        <div className="flex justify-center py-16 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No posts yet in this category.</p>
          {currentUserId && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-mono-tech transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Start the conversation
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              onClick={() => setActivePost(post)}
              onUpvote={handleUpvote}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {!currentUserId && (
        <p className="mt-4 text-center text-xs text-slate-500">
          Sign in to post, comment, and upvote.
        </p>
      )}

      {showCreate && (
        <CreatePostModal
          onClose={() => setShowCreate(false)}
          onCreated={post => { setPosts(prev => [post, ...prev]); setShowCreate(false); }}
        />
      )}

      {activePost && (
        <PostDetailModal
          post={activePost}
          currentUserId={currentUserId}
          onClose={() => setActivePost(null)}
          onUpvote={handleUpvote}
          onDelete={handleDelete}
        />
      )}
    </>
  );
};

// ---------------------------------------------------------------------------
// EventsView
// ---------------------------------------------------------------------------

const EventsView: React.FC = () => {
  const [events, setEvents]   = useState<CommunityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEvents().then(data => { setEvents(data); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-16 text-slate-500">
        <Calendar className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm font-semibold text-slate-400 mb-1">No Upcoming Events</p>
        <p className="text-xs leading-relaxed max-w-xs mx-auto">
          Check back soon — scanner conventions, meetups, and online Q&amp;As will be listed here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.map(ev => (
        <div key={ev.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 animate-fade-in">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono-tech text-amber-400 font-bold uppercase">
                  {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-white leading-snug mb-1.5">{ev.title}</h3>
              {ev.description && (
                <p className="text-xs text-slate-400 leading-relaxed mb-2">{ev.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono-tech">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatEventDate(ev.event_date)}
                  {ev.event_time && ` at ${ev.event_time}`}
                </span>
                {ev.location_text && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {ev.location_text}
                  </span>
                )}
              </div>
            </div>
            {ev.url && (
              <a
                href={ev.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 p-2 rounded-lg text-slate-500 hover:text-cyan-400 hover:bg-slate-800 transition-colors"
                title="Event link"
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// TipsView — static scanner tips & tutorials
// ---------------------------------------------------------------------------

interface TipSection {
  Icon: React.ElementType;
  color: string;
  title: string;
  items: string[];
}

const TIP_SECTIONS: TipSection[] = [
  {
    Icon: Radio, color: 'text-cyan-400',
    title: 'Getting Started with Scanners',
    items: [
      'Start with a zip-code search to get frequencies for your exact area.',
      'Ham frequencies (144–148 MHz, 420–450 MHz) are a good introduction — no license needed to listen.',
      'Use the EXPLORE map to see what other users have already scanned near you.',
      'Enable "Cloud Cache" status on the home screen to confirm your data is being saved.',
    ],
  },
  {
    Icon: Wrench, color: 'text-emerald-400',
    title: 'Programming Your Scanner',
    items: [
      'Use the "Programming Manual" export for step-by-step Uniden SDS100/SDS200 instructions.',
      'Export to Sentinel ZIP for a full package compatible with Uniden\'s Sentinel software.',
      'CHIRP CSV export works with most supported radios — check CHIRP\'s compatibility list.',
      'For trunked (P25/DMR) systems, you need the control channel frequencies AND talkgroups.',
      'Confirm active frequencies with "Heard It" to help the community know which channels are live.',
    ],
  },
  {
    Icon: Lightbulb, color: 'text-amber-400',
    title: 'Tips for Better Results',
    items: [
      'For rural areas, search by county name (e.g., "Jackson County, GA") for broader coverage.',
      'Connect a RadioReference Premium account in Settings to pull verified database frequencies.',
      'If you\'re on a road trip, use TRIP mode to pre-program frequencies for each zone of your route.',
      'Trunked systems often have many talkgroups — filter to just Police and Fire to reduce clutter.',
      'Cross-Reference Verification (the green shield) means the data was confirmed by multiple sources.',
    ],
  },
  {
    Icon: Scale, color: 'text-rose-400',
    title: 'Legal & Etiquette',
    items: [
      'Monitoring public safety frequencies is legal in most US states for personal use.',
      'It is illegal in all US states to use scanner information to aid in the commission of a crime.',
      'Some states (e.g., Indiana, Florida) restrict mobile scanner use — know your local laws.',
      'Do not share recordings of sensitive personal information or medical details.',
      'Encrypted channels exist for a reason — if you can\'t decode them, move on.',
    ],
  },
  {
    Icon: HeartHandshake, color: 'text-purple-400',
    title: 'Growing the Community',
    items: [
      'Use the Forum to share frequency finds, ask questions, and connect with local scanner fans.',
      'The Leaderboard (RANKS tab) rewards users who submit and confirm frequencies.',
      'Use "Contribute" on any search result to submit a frequency you heard in the field.',
      '"Boy & A Scanner" merchandise helps fund server and AI costs — thank you for your support!',
      'Found a bug or have a feature request? Use the envelope icon in the nav to reach out.',
    ],
  },
];

const TipsView: React.FC = () => (
  <div className="space-y-4">
    {TIP_SECTIONS.map(({ Icon, color, title, items }) => (
      <div key={title} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 animate-fade-in">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-slate-800">
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <h3 className="text-sm font-bold text-white font-mono-tech">{title}</h3>
        </div>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-slate-400 leading-relaxed">
              <Star className={`w-3 h-3 mt-0.5 shrink-0 ${color} opacity-70`} />
              {item}
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// CommunityHub — main export
// ---------------------------------------------------------------------------

interface CommunityHubProps {
  session: Session | null;
}

export const CommunityHub: React.FC<CommunityHubProps> = ({ session }) => {
  const [subView, setSubView] = useState<SubView>('forum');

  const NAV: { key: SubView; label: string; Icon: React.ElementType; color: string; active: string }[] = [
    { key: 'forum',  label: 'FORUM',    Icon: Users,      color: 'text-cyan-400',   active: 'bg-cyan-600/20 border-cyan-600/50 text-cyan-400' },
    { key: 'events', label: 'EVENTS',   Icon: Calendar,   color: 'text-amber-400',  active: 'bg-amber-600/20 border-amber-600/50 text-amber-400' },
    { key: 'tips',   label: 'TIPS',     Icon: BookOpen,   color: 'text-purple-400', active: 'bg-purple-600/20 border-purple-600/50 text-purple-400' },
  ];

  return (
    <div className="max-w-3xl mx-auto animate-fade-in">
      {/* Section header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2 bg-gradient-to-tr from-cyan-700 to-blue-800 rounded-xl shadow-lg shadow-cyan-900/20">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white font-mono-tech tracking-tight">SCANNER COMMUNITY</h2>
          <p className="text-xs text-slate-400 font-mono-tech">Forum · Events · Tips &amp; Tutorials</p>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex items-center gap-2 mb-5 bg-slate-900/50 border border-slate-800 rounded-xl p-1.5">
        {NAV.map(({ key, label, Icon, active }) => (
          <button
            key={key}
            onClick={() => setSubView(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono-tech font-bold border transition-all ${
              subView === key ? active : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {subView === 'forum'  && <ForumView  currentUserId={session?.user.id} />}
      {subView === 'events' && <EventsView />}
      {subView === 'tips'   && <TipsView />}
    </div>
  );
};
