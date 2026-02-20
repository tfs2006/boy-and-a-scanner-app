
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import L from 'leaflet';

// Fix for default Leaflet marker icons in React
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapDisplayProps {
    coords: { lat: number; lng: number };
    locationName: string;
}

// Component to recenter map when coords change
const RecenterMap = ({ coords }: { coords: { lat: number; lng: number } }) => {
    const map = useMap();
    useEffect(() => {
        map.flyTo([coords.lat, coords.lng], 10);
    }, [coords, map]);
    return null;
};

export const MapDisplay: React.FC<MapDisplayProps> = ({ coords, locationName }) => {
    if (!coords || !coords.lat || !coords.lng) return null;

    return (
        <div className="h-64 w-full rounded-lg overflow-hidden border border-slate-700 shadow-lg relative z-0 animate-fade-in mb-8">
            <MapContainer
                center={[coords.lat, coords.lng]}
                zoom={10}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                <Marker position={[coords.lat, coords.lng]}>
                    <Popup>
                        <div className="text-slate-900 font-bold">{locationName}</div>
                    </Popup>
                </Marker>
                <RecenterMap coords={coords} />
            </MapContainer>
            <div className="absolute top-2 right-2 bg-slate-900/80 backdrop-blur px-2 py-1 rounded border border-slate-700 text-[10px] text-slate-400 font-mono-tech z-[400] pointer-events-none">
                LAT: {coords.lat.toFixed(4)} LON: {coords.lng.toFixed(4)}
            </div>
        </div>
    );
};
