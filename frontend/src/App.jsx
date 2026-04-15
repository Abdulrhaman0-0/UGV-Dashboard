import { useState, useRef, useCallback, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Fix for default marker icon in Leaflet
import markerIcon   from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl:    markerIcon,
    shadowUrl:  markerShadow,
    iconSize:   [25, 41],
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

/* ── Custom UGV Marker — matches design token --accent-primary ── */
const UgvIcon = L.divIcon({
    className: 'ugv-marker-icon',
    html: `<div style="
        background: rgba(0,255,65,0.12);
        border: 2px solid #00FF41;
        border-radius: 4px;
        padding: 4px;
        box-shadow: 0 0 18px rgba(0,255,65,0.6);
        color: #00FF41;
        display:flex;
        align-items:center;
        justify-content:center;
        width:38px;
        height:38px;
        font-size:18px;
    ">🚙</div>`,
    iconSize:   [38, 38],
    iconAnchor: [19, 19],
});

/* ── Map auto-track helper ── */
function MapTracker({ position, active }) {
    const map = useMap();
    useEffect(() => {
        if (active && position?.[0] && position?.[1]) {
            map.flyTo(position, map.getZoom(), { animate: true, duration: 0.8 });
        }
    }, [position, active, map]);
    return null;
}

/* ── Static ROS2 set_route payload ── */
const STATIC_ROUTE = {
    type: 'set_route',
    data: {
        route: [
            { header: { frame_id: 'map' }, pose: { position: { x: 0.0, y: 0.0, z: 0.0 } } },
        ],
    },
};

/* ── Helpers ── */
function wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}`;
}

const formatPST = () =>
    new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12:   false,
    }) + ' PST';

/* ══════════════════════════════════════════════════════════════════
   App Component
   ══════════════════════════════════════════════════════════════════ */
export default function App() {
    // ── Auth & connectivity state ──
    const [screen,   setScreen]   = useState('login');
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('admin123');
    const [status,   setStatus]   = useState('Disconnected');

    // ── Telemetry & operational state ──
    const [logs,         setLogs]         = useState([]);
    const [telemetry,    setTelemetry]    = useState(null);
    const [autoTrack,    setAutoTrack]    = useState(true);
    const [clock,        setClock]        = useState(formatPST());
    const [manualMode,   setManualMode]   = useState(true);
    const [speedRequest, setSpeedRequest] = useState(2.4);

    // ── Camera toggle ──
    const [cameraOpen, setCameraOpen] = useState(false);

    const wsRef        = useRef(null);
    const logScrollRef = useRef(null);

    /* Clock ticker */
    useEffect(() => {
        const timer = setInterval(() => setClock(formatPST()), 1000);
        return () => clearInterval(timer);
    }, []);

    /* Auto-scroll log console */
    useEffect(() => {
        if (logScrollRef.current) {
            logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
        }
    }, [logs]);

    /* Append a log entry (max 50 entries) */
    const addLog = useCallback((tag, msg, isAlert = false) => {
        setLogs(prev =>
            [...prev, { time: new Date().toLocaleTimeString('en-GB'), tag, msg, alert: isAlert }]
                .slice(-50),
        );
    }, []);

    /* Send a message over the WebSocket */
    const send = useCallback((obj) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(obj));
        }
    }, []);

    /* ── Login / WebSocket init ── */
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
                    addLog('SYSTEM', 'Authentication successful');
                    break;
                case 'auth_fail':
                    setStatus('Auth failed');
                    addLog('AUTH', `Failed: ${msg.message}`, true);
                    ws.close();
                    break;
                case 'telemetry':
                    setTelemetry(msg.data);
                    if (Math.random() > 0.95 && msg.data.speed > 0) {
                        addLog('GPS', `Position: ${msg.data.gps.lat.toFixed(4)}°N`);
                    }
                    if (msg.data.batteryPercent < 20 && Math.random() > 0.98) {
                        addLog('ALERT', '⚠ Battery critically low', true);
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
        setLogs([]);
    };

    /* ── Derived telemetry ── */
    const batt      = Math.round(telemetry?.batteryPercent ?? 0);
    const battLow   = batt > 0 && batt < 20;
    const battColor = battLow ? 'var(--accent-red)' : 'var(--accent-primary)';
    const speed     = (telemetry?.speed ?? 0).toFixed(1);
    const heading   = Math.round(telemetry?.heading ?? 0);
    const lat       = (telemetry?.gps?.lat ?? 0).toFixed(5);
    const lng       = (telemetry?.gps?.lng ?? 0).toFixed(5);
    const temp      = telemetry?.componentsTemp ? Math.round(telemetry.componentsTemp) : '--';
    const tempHigh  = typeof temp === 'number' && temp > 70;
    const isOnline  = status === 'OPERATIONAL';
    const ugvPos    = telemetry?.gps
        ? [telemetry.gps.lat, telemetry.gps.lng]
        : [34.0522, -118.2437]; // Default: LA

    /* ════════════════════════════════════════════════════════════════
       LOGIN SCREEN
       ════════════════════════════════════════════════════════════════ */
    if (screen === 'login') {
        return (
            <div className="login-overlay" role="main">
                <div className="login-card" aria-label="UGV Command Center Login">
                    <span className="login-logo" aria-hidden="true">⬡</span>
                    <h1>UGV COMMAND CENTER</h1>
                    <p className="login-subtitle">SECURE REMOTE OPERATIONS v1.2</p>
                    <form onSubmit={handleLogin} noValidate>
                        <label htmlFor="ugv-username" style={{ display:'none' }}>Access Code</label>
                        <input
                            id="ugv-username"
                            type="text"
                            placeholder="Access Code"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            autoComplete="username"
                            required
                        />
                        <label htmlFor="ugv-password" style={{ display:'none' }}>Passphrase</label>
                        <input
                            id="ugv-password"
                            type="password"
                            placeholder="Passphrase"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                        <button type="submit" className="btn-primary" id="login-submit-btn">
                            INITIALIZE CONNECTION
                        </button>
                    </form>
                    <span className="status-badge" aria-live="polite">{status}</span>
                </div>
            </div>
        );
    }

    /* ════════════════════════════════════════════════════════════════
       DASHBOARD SCREEN
       ════════════════════════════════════════════════════════════════ */
    return (
        <div className="app">

            {/* ── Header ── */}
            <header className="top-header" role="banner">
                <div className="header-left">
                    <span className="header-menu-icon" aria-hidden="true">≡</span>
                    <span className="header-title">UGV COMMAND CENTER</span>
                    <span className="header-version">v1.2</span>
                </div>

                <div className="header-center" aria-label="Current time">{clock}</div>

                <div className="header-right">
                    <div className="header-status" aria-live="polite">
                        <span>STATUS:</span>
                        <span
                            className="status-label"
                            style={{ color: isOnline ? 'var(--accent-primary)' : 'var(--fg-secondary)' }}
                        >
                            {status}
                        </span>
                    </div>

                    <div className="header-user" aria-label="Logged in user">
                        <div className="user-avatar" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                                <circle cx="12" cy="7" r="4"/>
                            </svg>
                        </div>
                        <div>
                            <div style={{ color: 'var(--fg-primary)', fontWeight: 600 }}>Admin</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-secondary)' }}>John D.</div>
                        </div>
                    </div>

                    <button
                        className="header-disconnect-btn"
                        onClick={handleDisconnect}
                        id="disconnect-btn"
                        aria-label="Disconnect from vehicle"
                    >
                        DISCONNECT
                    </button>
                </div>
            </header>

            {/* ── Dashboard Grid ── */}
            <main className="dashboard-grid" role="main">

                {/* ═══ LEFT SIDEBAR — Manual Control ═══ */}
                <div className="panel sidebar-left" aria-label="Manual Control Panel">
                    <div className="panel-title">
                        <span className="panel-icon" aria-hidden="true">⬡</span>
                        Manual Control
                    </div>

                    {/* Action buttons */}
                    <div className="section-label">Operations</div>
                    <div className="control-buttons-stack">
                        <button
                            className="btn-action engage"
                            id="btn-engage"
                            onClick={() => addLog('SYSTEM', 'Manual control engaged')}
                            aria-label="Engage manual control"
                        >
                            ▶ ENGAGE
                        </button>
                        <button
                            className="btn-action disengage"
                            id="btn-disengage"
                            onClick={() => addLog('SYSTEM', 'System disengaged', true)}
                            aria-label="Disengage system"
                        >
                            ■ DISENGAGE
                        </button>
                        <button
                            className="btn-action"
                            id="btn-follow-path"
                            aria-label="Follow path mode"
                        >
                            FOLLOW PATH
                        </button>
                        <button
                            className="btn-action"
                            id="btn-auto-nav"
                            onClick={() => { send(STATIC_ROUTE); addLog('CMD', 'Auto Nav initiated'); }}
                            aria-label="Start autonomous navigation"
                        >
                            AUTO NAV
                        </button>
                    </div>

                    {/* D-PAD directional control */}
                    <div className="section-label" style={{ marginTop: 'var(--sp-2)' }}>Directional</div>
                    <div className="dpad-section">
                        <div className="dpad-container">
                            <div
                                className="dpad-cross"
                                role="group"
                                aria-label="Directional control pad"
                            >
                                <button
                                    className="dbtn n"
                                    id="dbtn-forward"
                                    onClick={() => send({ type: 'manual_cmd', data: { direction: 'forward' } })}
                                    aria-label="Move forward"
                                >▲</button>
                                <button
                                    className="dbtn w"
                                    id="dbtn-left"
                                    onClick={() => send({ type: 'manual_cmd', data: { direction: 'left' } })}
                                    aria-label="Turn left"
                                >◀</button>
                                <button
                                    className="dbtn e"
                                    id="dbtn-right"
                                    onClick={() => send({ type: 'manual_cmd', data: { direction: 'right' } })}
                                    aria-label="Turn right"
                                >▶</button>
                                <button
                                    className="dbtn s"
                                    id="dbtn-backward"
                                    onClick={() => send({ type: 'manual_cmd', data: { direction: 'backward' } })}
                                    aria-label="Move backward"
                                >▼</button>
                            </div>
                            <button
                                className="btn-stop"
                                id="btn-stop"
                                onClick={() => send({ type: 'manual_cmd', data: { direction: 'stop' } })}
                                aria-label="Emergency stop"
                            >
                                ⬛ STOP
                            </button>
                        </div>
                    </div>

                    {/* Mode toggles */}
                    <div className="section-label" style={{ marginTop: 'var(--sp-2)' }}>Drive Mode</div>
                    <div
                        className="mode-toggles"
                        role="radiogroup"
                        aria-label="Drive mode selection"
                    >
                        <div
                            className={`radio-item ${!manualMode ? 'active' : ''}`}
                            onClick={() => setManualMode(false)}
                            role="radio"
                            aria-checked={!manualMode}
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && setManualMode(false)}
                            id="mode-autonomous"
                        >
                            <div className="radio-circle">
                                {!manualMode && <div className="inner" />}
                            </div>
                            Autonomous
                        </div>
                        <div
                            className={`radio-item ${manualMode ? 'active' : ''}`}
                            onClick={() => setManualMode(true)}
                            role="radio"
                            aria-checked={manualMode}
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && setManualMode(true)}
                            id="mode-manual"
                        >
                            <div className="radio-circle">
                                {manualMode && <div className="inner" />}
                            </div>
                            Manual Remote
                        </div>
                    </div>

                    {/* Speed slider */}
                    <div className="section-label" style={{ marginTop: 'var(--sp-2)' }}>Max Speed</div>
                    <div className="speed-slider">
                        <div className="slider-labels">
                            <span>0 m/s</span>
                            <span className="slider-val">{speedRequest.toFixed(1)} m/s</span>
                            <span>5.0 m/s</span>
                        </div>
                        <div className="slider-rail">
                            <div className="slider-fill" style={{ width: `${(speedRequest / 5) * 100}%` }} />
                            <div className="slider-thumb" style={{ left: `${(speedRequest / 5) * 100}%` }} />
                            <input
                                type="range"
                                min="0" max="5" step="0.1"
                                className="slider-input-overlay"
                                value={speedRequest}
                                id="speed-slider"
                                aria-label="Speed request"
                                onChange={e => setSpeedRequest(parseFloat(e.target.value))}
                                onMouseUp={e => addLog('CMD', `Speed set: ${e.target.value} m/s`)}
                            />
                        </div>
                    </div>
                </div>

                {/* ═══ CENTER — Map + Log Console ═══ */}
                <div className="map-wrap" aria-label="Vehicle map and event log">
                    {/* Map tools bar */}
                    <div className="map-tools">
                        <button
                            className={`map-tool-btn ${autoTrack ? 'active' : ''}`}
                            id="auto-track-btn"
                            onClick={() => setAutoTrack(!autoTrack)}
                            aria-pressed={autoTrack}
                            aria-label={autoTrack ? 'Disable auto-focus' : 'Enable auto-focus'}
                        >
                            {autoTrack ? '⊙ Auto-Focus ON' : '○ Auto-Focus OFF'}
                        </button>
                    </div>

                    {/* Leaflet map */}
                    <MapContainer
                        center={ugvPos}
                        zoom={16}
                        zoomControl={false}
                        className="leaflet-container"
                        aria-label="UGV location map"
                    >
                        <TileLayer
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            attribution="Esri World Imagery"
                        />
                        <Marker position={ugvPos} icon={UgvIcon}>
                            <Popup>
                                <strong>UGV-01</strong><br/>
                                Status: {isOnline ? 'ONLINE' : 'OFFLINE'}<br/>
                                Lat: {lat}° · Lng: {lng}°
                            </Popup>
                        </Marker>
                        <MapTracker position={ugvPos} active={autoTrack} />
                    </MapContainer>

                    {/* Floating log/event console */}
                    <div className="log-console" role="log" aria-live="polite" aria-label="System event log">
                        <div className="log-console-header">
                            <div className="log-console-dot" aria-hidden="true" />
                            EVENT LOG
                        </div>
                        <div className="log-scroll" ref={logScrollRef}>
                            {logs.length === 0 && (
                                <div className="log-line">
                                    <span className="log-time">[{clock.split(' ')[0]}]</span>
                                    <span className="log-tag">SYSTEM:</span>
                                    <span className="log-msg">Waiting for events…</span>
                                </div>
                            )}
                            {logs.map((l, i) => (
                                <div key={i} className="log-line">
                                    <span className="log-time">[{l.time}]</span>
                                    <span className={`log-tag ${l.alert ? 'alert' : ''}`}>{l.tag}:</span>
                                    <span className="log-msg">{l.msg}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ═══ RIGHT SIDEBAR — Telemetry Widgets ═══ */}
                <div className="right-sidebar" aria-label="Telemetry widgets">

                    {/* Battery Ring */}
                    <div className={`widget ${battLow ? 'alert-border' : ''}`} aria-label={`Battery: ${batt}%`}>
                        <div className="widget-title">
                            <span className="widget-title-icon" aria-hidden="true">⚡</span>
                            Battery
                            {battLow && (
                                <span className="alert-badge critical" role="alert" aria-label="Critical battery level">
                                    ⚠ LOW
                                </span>
                            )}
                        </div>
                        <div className="battery-wrap">
                            <svg viewBox="0 0 36 36" className="circular-chart" aria-hidden="true">
                                <path
                                    className="circle-bg"
                                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                />
                                <path
                                    className="circle"
                                    strokeDasharray={`${batt}, 100`}
                                    stroke={battColor}
                                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                />
                                <text x="18" y="20.35" className="percentage">{batt}%</text>
                            </svg>
                            <div className="battery-meta">
                                <span className="battery-label">Charge Level</span>
                                <span className={`battery-status ${battLow ? 'low' : 'ok'}`}>
                                    {battLow ? '⚠ CRITICAL' : '● NOMINAL'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Speed bar */}
                    <div className="widget" aria-label={`Speed: ${speed} m/s`}>
                        <div className="widget-title">
                            <span className="widget-title-icon" aria-hidden="true">⚡</span>
                            Speed
                        </div>
                        <div className="speed-bar-wrap">
                            <div className="speed-ticks" aria-hidden="true" role="presentation">
                                {[...Array(15)].map((_, i) => (
                                    <div
                                        key={i}
                                        className={`tick ${(i / 15) * 5 <= speed ? 'active' : ''}`}
                                    />
                                ))}
                            </div>
                            <span className="speed-val">
                                {speed} <span className="speed-unit">m/s</span>
                            </span>
                        </div>
                    </div>

                    {/* Compass */}
                    <div className="widget" aria-label={`Heading: ${heading} degrees`}>
                        <div className="widget-title">
                            <span className="widget-title-icon" aria-hidden="true">🧭</span>
                            Compass
                        </div>
                        <div className="compass-wrap">
                            <div className="compass-circle">
                                <div
                                    className="compass-arrow"
                                    style={{ transform: `rotate(${heading}deg)` }}
                                    aria-hidden="true"
                                >▼</div>
                                <div className="compass-val">{heading}°</div>
                            </div>
                        </div>
                    </div>

                    {/* GPS Coordinates */}
                    <div className="widget" aria-label={`GPS: ${lat}°N, ${lng}°W`}>
                        <div className="widget-title">
                            <span className="widget-title-icon" aria-hidden="true">📡</span>
                            GPS Position
                        </div>
                        <div className="gps-text">
                            <div>{lat}° N</div>
                            <div>{lng}° W</div>
                        </div>
                    </div>

                    {/* Status & Temperature */}
                    <div
                        className="status-grid"
                        role="region"
                        aria-label="System status indicators"
                    >
                        {/* Connection status */}
                        <div className={`status-box ${!isOnline ? 'alert-border' : ''}`}>
                            <div className="status-box-title">STATUS</div>
                            <div
                                className="status-box-val"
                                style={{ color: isOnline ? 'var(--accent-primary)' : 'var(--fg-secondary)' }}
                            >
                                <div className={`status-indicator ${isOnline ? 'online' : ''}`} aria-hidden="true" />
                                {isOnline ? 'ONLINE' : 'OFFLINE'}
                            </div>
                        </div>

                        {/* Temperature */}
                        <div className={`status-box ${tempHigh ? 'warn-border' : ''}`}>
                            <div className="status-box-title">TEMP</div>
                            <div
                                className="status-box-val"
                                style={{ color: tempHigh ? 'var(--accent-amber)' : 'var(--fg-primary)' }}
                            >
                                {tempHigh && <span aria-label="High temperature warning">⚠ </span>}
                                {temp}°C
                            </div>
                        </div>
                    </div>

                    {/* ── Camera — Toggleable Feed ── */}
                    <div
                        className={`camera-widget ${cameraOpen ? 'camera-expanded' : ''}`}
                        aria-label="Camera view panel"
                    >
                        <div className="camera-header">
                            <div className="camera-title">
                                <span aria-hidden="true">📷</span>
                                CAMERA
                                <span className="camera-live-dot" aria-label="Recording indicator" />
                                FRONT VIEW
                            </div>
                            <button
                                className={`camera-toggle-btn ${cameraOpen ? 'active' : ''}`}
                                id="camera-toggle-btn"
                                onClick={() => setCameraOpen(v => !v)}
                                aria-expanded={cameraOpen}
                                aria-controls="camera-feed-panel"
                                aria-label={cameraOpen ? 'Hide camera feed' : 'Show camera feed'}
                            >
                                <span className="camera-toggle-icon" aria-hidden="true">▾</span>
                                {cameraOpen ? 'HIDE' : 'SHOW'} FEED
                            </button>
                        </div>

                        {/* Collapsible feed area */}
                        <div
                            className="camera-feed-panel"
                            id="camera-feed-panel"
                            role="region"
                            aria-label="Live camera feed"
                        >
                            <div className="camera-view">
                                {/* Placeholder — replace `src` with your MJPEG/WebRTC stream */}
                                {/* <img src="/api/camera_stream" alt="UGV front camera live feed" /> */}
                                <div className="camera-no-signal" aria-label="No video signal">
                                    <div className="camera-no-signal-icon" aria-hidden="true">📹</div>
                                    <span>NO SIGNAL</span>
                                </div>
                                <div className="camera-overlay" aria-hidden="true">
                                    <span className="camera-overlay-text">UGV-01 · FRONT · {clock}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>{/* end right-sidebar */}
            </main>
        </div>
    );
}
