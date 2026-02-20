
import { supabase } from './supabaseClient';

export interface Favorite {
    id: string;
    location_query: string;
    label: string | null;
    created_at: string;
}

/**
 * Fetch all favorites for the current authenticated user.
 * Returns empty array if Supabase is unavailable or user is not logged in.
 */
export async function getFavorites(): Promise<Favorite[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('favorites')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching favorites:', error.message);
        return [];
    }

    return data || [];
}

/**
 * Add a location to the user's favorites.
 * Returns the new favorite object, or null on failure.
 */
export async function addFavorite(locationQuery: string, label?: string): Promise<Favorite | null> {
    if (!supabase) return null;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
        .from('favorites')
        .insert({
            user_id: user.id,
            location_query: locationQuery.trim(),
            label: label || null,
        })
        .select()
        .single();

    if (error) {
        console.error('Error adding favorite:', error.message);
        return null;
    }

    return data;
}

/**
 * Remove a favorite by its ID.
 */
export async function removeFavorite(id: string): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('Error removing favorite:', error.message);
        return false;
    }

    return true;
}
