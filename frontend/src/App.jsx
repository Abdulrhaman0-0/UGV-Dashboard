import { useState, useRef, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icon in Leaflet
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

/* ── Custom UGV Marker Icon ── */
const UgvIcon = L.divIcon({
    className: 'ugv-marker-icon',
    html: `<div style="background: rgba(56, 189, 248, 0.2); border: 2px solid #38bdf8; border-radius: 4px; padding: 4px; box-shadow: 0 0 15px rgba(56,189,248,0.8); color: #38bdf8; display:flex; align-items:center; justify-content:center; width:40px; height:40px;">🚙</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20]
});

/* ── Map Components ─────────────────────────────────────────── */
function MapTracker({ position, active }) {
    const map = useMap();
    useEffect(() => {
        if (active && position && position[0] && position[1]) {
            map.flyTo(position, map.getZoom(), { animate: true });
        }
    }, [position, active, map]);
    return null;
}

/* ── Static ROS2 route (set_route) ────────────────────────────────────── */
const STATIC_ROUTE = {
    type: 'set_route',
    data: {
        route: [
            { header: { frame_id: 'map' }, pose: { position: { x: 0.0, y: 0.0, z: 0.0 } } }
        ],
    },
};

/* ── Helpers ─────────────────────────────────────────────────────── */
function wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}`;
}

// Format Time
const formatPST = () => {
    return new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour12: false }) + ' PST';
};

/* ================================================================ */
/*  App                                                              */
/* ================================================================ */
export default function App() {
    const [screen, setScreen] = useState('login'); 
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('admin123');
    const [status, setStatus] = useState('Disconnected');
    const [logs, setLogs] = useState([]);
    const [telemetry, setTelemetry] = useState(null);
    const [autoTrack, setAutoTrack] = useState(true);
    const [clock, setClock] = useState(formatPST());
    const [manualMode, setManualMode] = useState(true);
    const [speedRequest, setSpeedRequest] = useState(2.4);

    const wsRef = useRef(null);
    const logScrollRef = useRef(null);

    // Clock effect
    useEffect(() => {
        const timer = setInterval(() => setClock(formatPST()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Auto-scroll logs
    useEffect(() => {
        if (logScrollRef.current) {
            logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
        }
    }, [logs]);

    const addLog = useCallback((tag, msg, isAlert = false) => {
        setLogs((prev) => [
            ...prev,
            { time: new Date().toLocaleTimeString('en-GB'), tag, msg, alert: isAlert }
        ].slice(-50));
    }, []);

    const send = useCallback((obj) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(obj));
        }
    }, []);

    const handleLogin = (e) => {
        e.preventDefault();
        setStatus('Connecting…');
        const ws = new WebSocket(wsUrl());
        wsRef.current = ws;

        ws.onopen = () => {
            setStatus('Authenticating…');
            ws.send(JSON.stringify({ type: 'auth', data: { username, password } }));
        };

        ws.onmessage = (evt) => {
            let msg;
            try { msg = JSON.parse(evt.data); } catch { return; }

            switch (msg.type) {
                case 'auth_ok':
                    setStatus('OPERATIONAL');
                    setScreen('dashboard');
                    addLog('SYSTEM', 'Authentication Successful');
                    break;
                case 'auth_fail':
                    setStatus('Auth failed');
                    addLog('AUTH', `Failed: ${msg.message}`, true);
                    ws.close();
                    break;
                case 'telemetry':
                    setTelemetry(msg.data);
                    // Add periodic location log randomly for effect if speed > 0
                    if (Math.random() > 0.95 && msg.data.speed > 0) {
                        addLog('GPS', `Position Update ${msg.data.gps.lat.toFixed(4)}°N`);
                    }
                    if (msg.data.batteryPercent < 20 && Math.random() > 0.98) {
                        addLog('ALERT', 'Battery level critical', true);
                    }
                    break;
                case 'cmd_ack':
                case 'waypoint_ack':
                    addLog('CMD', msg.message);
                    break;
                case 'error':
                    addLog('ERROR', msg.message, true);
                    break;
                default:
                    break;
            }
        };

        ws.onclose = () => setStatus('OFFLINE');
        ws.onerror = () => setStatus('OFFLINE');
    };

    const handleDisconnect = () => {
        wsRef.current?.close();
        setScreen('login');
        setTelemetry(null);
        setStatus('Disconnected');
    };

    // Calculate derived telemetry mappings from the real backend stream
    const batt = Math.round(telemetry?.batteryPercent ?? 0);
    const battColor = batt > 20 ? '#4ade80' : '#f87171';
    const speed = (telemetry?.speed ?? 0).toFixed(1);
    const heading = Math.round(telemetry?.heading ?? 0);
    const lat = (telemetry?.gps?.lat ?? 0).toFixed(4);
    const lng = (telemetry?.gps?.lng ?? 0).toFixed(4);
    const temp = telemetry?.componentsTemp ? Math.round(telemetry.componentsTemp) : 0;
    const isOnline = status === 'OPERATIONAL';
    const ugvPos = telemetry?.gps ? [telemetry.gps.lat, telemetry.gps.lng] : [34.0522, -118.2437]; // Default LA if no data

    if (screen === 'login') {
        return (
            <div className="login-overlay">
                <div className="login-card">
                    <div className="login-logo">⬡</div>
                    <h1>UGV COMMAND CENTER</h1>
                    <form onSubmit={handleLogin}>
                        <input type="text" placeholder="Access Code" value={username} onChange={e=>setUsername(e.target.value)} required />
                        <input type="password" placeholder="Passphrase" value={password} onChange={e=>setPassword(e.target.value)} required />
                        <button type="submit" className="btn-primary">INITIALIZE CONNECTION</button>
                    </form>
                    <span className="status-badge">{status}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            {/* Header */}
            <header className="top-header">
                <div className="header-left">
                    <span className="header-menu-icon">≡</span>
                    <span className="header-title">UGV COMMAND CENTER</span>
                    <span className="header-version">v1.2</span>
                </div>
                <div className="header-center">{clock}</div>
                <div className="header-right">
                    <div className="header-status">
                        Status: 
                        <span className="status-label" style={{color: isOnline ? '#4ade80' : '#94a3b8'}}>{status}</span>
                    </div>
                    <div className="header-user">
                        <div className="user-avatar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                        </div>
                        <div>
                            Admin<br/>John D.
                        </div>
                    </div>
                </div>
            </header>

            <main className="dashboard-grid">
                {/* Left Sidebar */}
                <div className="panel sidebar-left">
                    <div className="panel-title"><span className="panel-icon">⬡</span> Manual Control</div>
                    
                    <div className="control-buttons-stack">
                        <button className="btn-action engage" onClick={() => addLog('SYSTEM', 'Manual Control Engaged')}>ENGAGE</button>
                        <button className="btn-action disengage" onClick={() => addLog('SYSTEM', 'System Disengaged', true)}>DISENGAGE</button>
                        <button className="btn-action">FOLLOW PATH</button>
                        <button className="btn-action" onClick={() => { send(STATIC_ROUTE); addLog('CMD', 'Auto Nav Initiated'); }}>AUTO NAV</button>
                    </div>

                    <div className="dpad-container">
                        <div className="dpad-cross">
                            <button className="dbtn n" onClick={()=>send({type:'manual_cmd',data:{direction:'forward'}})}>N</button>
                            <button className="dbtn w" onClick={()=>send({type:'manual_cmd',data:{direction:'left'}})}>W</button>
                            <button className="dbtn e" onClick={()=>send({type:'manual_cmd',data:{direction:'right'}})}>E</button>
                            <button className="dbtn s" onClick={()=>send({type:'manual_cmd',data:{direction:'backward'}})}>S</button>
                        </div>
                        <button className="btn-stop" onClick={()=>send({type:'manual_cmd',data:{direction:'stop'}})}>Stop</button>
                    </div>

                    <div className="mode-toggles">
                        <div className={`radio-item ${!manualMode ? 'active' : ''}`} onClick={()=>setManualMode(false)}>
                            <div className="radio-circle"><div className="inner"></div></div> Autonomous
                        </div>
                        <div className={`radio-item ${manualMode ? 'active' : ''}`} onClick={()=>setManualMode(true)}>
                            <div className="radio-circle"><div className="inner"></div></div> Manual Remote
                        </div>
                    </div>

                    <div className="speed-slider">
                        <div className="slider-labels">
                            <span>0 - 5.0 m/s</span>
                            <span style={{color: '#fff', fontWeight: 600}}>{speedRequest} m/s</span>
                        </div>
                        <div className="slider-rail">
                            <div className="slider-fill" style={{width: `${(speedRequest/5)*100}%`}}></div>
                            <div className="slider-thumb" style={{left: `${(speedRequest/5)*100}%`}}></div>
                            <input 
                                type="range" min="0" max="5" step="0.1" 
                                className="slider-input-overlay"
                                value={speedRequest}
                                onChange={(e)=>setSpeedRequest(parseFloat(e.target.value))}
                                onMouseUp={(e)=>addLog('CMD', `Requested speed: ${e.target.value} m/s`)}
                            />
                        </div>
                    </div>
                </div>

                {/* Center Map */}
                <div className="map-wrap">
                    <div className="map-tools">
                        <button className={`map-tool-btn ${autoTrack?'active':''}`} onClick={()=>setAutoTrack(!autoTrack)}>
                            {autoTrack ? '[■] Auto-Focus ON' : '[ ] Auto-Focus OFF'}
                        </button>
                    </div>
                    
                    <MapContainer center={ugvPos} zoom={16} zoomControl={false} className="leaflet-container">
                        <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
                        <Marker position={ugvPos} icon={UgvIcon}>
                            <Popup><strong>UGV 01</strong><br/>Status: ONLINE</Popup>
                        </Marker>
                        <MapTracker position={ugvPos} active={autoTrack} />
                    </MapContainer>

                    {/* Overlay Event Log */}
                    <div className="log-console">
                        <div className="log-scroll" ref={logScrollRef}>
                            {logs.length === 0 && <div className="log-line"><span className="log-time">[{clock.split(' ')[0]}]</span><span className="log-msg">SYSTEM: Waiting for events...</span></div>}
                            {logs.map((l, i) => (
                                <div key={i} className="log-line">
                                    <span className="log-time">[{l.time}]</span>
                                    <span className={`log-tag ${l.alert?'alert':''}`}>{l.tag}:</span>
                                    <span className="log-msg">{l.msg}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Sidebar Widgets */}
                <div className="right-sidebar">
                    {/* Battery */}
                    <div className="widget">
                        <div className="widget-title">Battery</div>
                        <div className="battery-wrap">
                            <svg viewBox="0 0 36 36" className="circular-chart">
                                <path className="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                <path className="circle" strokeDasharray={`${batt}, 100`} stroke={battColor} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                                <text x="18" y="20.35" className="percentage">{batt}%</text>
                            </svg>
                        </div>
                    </div>

                    {/* Speed */}
                    <div className="widget">
                        <div className="widget-title">Speed</div>
                        <div className="speed-bar-wrap">
                            <div className="speed-ticks">
                                {[...Array(15)].map((_, i) => (
                                    <div key={i} className={`tick ${(i/15)*5 <= speed ? 'active' : ''}`}></div>
                                ))}
                            </div>
                            <span className="speed-val">{speed} <span style={{fontSize:'10px', color:'var(--text-muted)'}}>m/s</span></span>
                        </div>
                    </div>

                    {/* Compass */}
                    <div className="widget">
                        <div className="widget-title">Compass</div>
                        <div className="compass-wrap">
                            <div className="compass-circle">
                                <div className="compass-arrow" style={{transform:`rotate(${heading}deg)`}}>▼</div>
                                <div className="compass-val">{heading}°</div>
                            </div>
                        </div>
                    </div>

                    {/* GPS Coordinates */}
                    <div className="widget">
                        <div className="widget-title">GPS Coordinates</div>
                        <div className="gps-text">
                            {lat}°N<br/>
                            {lng}°W
                        </div>
                    </div>

                    {/* Status & Temp */}
                    <div className="status-grid">
                        <div className="status-box">
                            <div className="status-box-title">Status</div>
                            <div className="status-box-val" style={{color: isOnline ? 'var(--accent-green)' : 'var(--text-muted)'}}>
                                <div className={`status-indicator ${isOnline ? 'online' : ''}`}></div>
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </div>
                        </div>
                        <div className="status-box">
                            <div className="status-box-title">Temp</div>
                            <div className="status-box-val">
                                {temp}°C
                                <svg width="24" height="12" viewBox="0 0 24 12" fill="none" style={{marginLeft:'auto'}}>
                                    <path d="M0 10 L6 8 L12 11 L18 4 L24 6" stroke="var(--accent-blue)" strokeWidth="1.5" fill="none" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    {/* Camera */}
                    <div className="widget" style={{flex: 1, display: 'flex', flexDirection: 'column'}}>
                        <div className="widget-title" style={{marginBottom: '8px'}}>Camera (Front View)</div>
                        <div className="camera-view">
                            <div style={{opacity: 0.2}}>NO SIGNAL</div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
