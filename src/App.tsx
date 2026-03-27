import React, { Component, useState, useRef, useEffect } from 'react';
import { 
  auth, 
  db, 
  googleProvider 
} from './firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  setDoc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';
import { 
  APIProvider, 
  Map, 
  AdvancedMarker, 
  Pin,
  useMap,
  useMapsLibrary
} from '@vis.gl/react-google-maps';
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { 
  Camera, 
  Upload, 
  Download, 
  Trash2, 
  Scissors, 
  LogOut, 
  User as UserIcon,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
  Copy,
  Check,
  Key,
  Bookmark,
  Save,
  X,
  MapPin,
  MessageSquare,
  LayoutDashboard,
  TrendingUp,
  ShoppingBag,
  ChevronRight,
  ChevronLeft,
  Send,
  Sparkles,
  Info,
  Calendar,
  History,
  Sun,
  Cloud,
  Palette,
  Activity,
  Zap,
  ZapOff,
  FileText,
  Play,
  Pause,
  RotateCw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Toaster, toast } from 'sonner';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Utilities ---

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const retry = async <T extends unknown>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    const isQuota = errorMessage.includes("429") || 
                    errorMessage.includes("quota") || 
                    errorMessage.includes("RESOURCE_EXHAUSTED");
    const isTransient = errorMessage.includes("500") || 
                        errorMessage.includes("Rpc failed") || 
                        errorMessage.includes("xhr error") ||
                        errorMessage.includes("UNKNOWN");
    
    if (retries > 0 && (isQuota || isTransient)) {
      await sleep(delay);
      return retry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

function handleGenAIError(err: any): { message: string; isQuota: boolean; isAuth: boolean } {
  console.error("GenAI Error:", err);
  let errorMessage = err.message || String(err);
  
  // Handle object-based errors from SDK
  if (err.error && err.error.message) {
    errorMessage = err.error.message;
  } else if (typeof err === 'object' && !err.message) {
    try {
      errorMessage = JSON.stringify(err);
    } catch (e) {
      errorMessage = String(err);
    }
  }

  // Try to parse as JSON if it's a string that looks like an object
  if (typeof errorMessage === 'string' && errorMessage.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed.error && parsed.error.message) {
        errorMessage = parsed.error.message;
      }
    } catch (e) {
      // Not valid JSON, keep original
    }
  }

  const isAuth = errorMessage.includes("Requested entity was not found") || 
                 errorMessage.includes("PERMISSION_DENIED") || 
                 errorMessage.includes("permission denied") ||
                 errorMessage.includes("API_KEY_INVALID") ||
                 errorMessage.includes("API key not valid");
                 
  const isQuota = errorMessage.includes("429") || 
                  errorMessage.includes("quota") || 
                  errorMessage.includes("RESOURCE_EXHAUSTED") || 
                  errorMessage.includes("exceeded quota");

  // User-friendly mapping for common transient errors
  if (errorMessage.includes("Rpc failed") || errorMessage.includes("xhr error") || errorMessage.includes("500")) {
    errorMessage = "The AI service is temporarily unavailable due to a network error. We are retrying automatically, but if it persists, please try again in a moment.";
  }

  return { message: errorMessage, isQuota, isAuth };
}

// --- Types ---
declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface Generation {
  id: string;
  userId: string;
  originalImageUrl: string;
  generatedImageUrl: string;
  prompt: string;
  createdAt: string;
  expiresAt: string;
  barberTalk?: string;
  shirtRecommendation?: string;
  pantRecommendation?: string;
}

interface SavedPreference {
  id: string;
  userId: string;
  name: string;
  styleName: string;
  customPrompt: string;
  createdAt: string;
}

interface GrowthLog {
  id: string;
  userId: string;
  imageUrl: string;
  notes: string;
  createdAt: string;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

interface Product {
  name: string;
  description: string;
  reason: string;
  category: string;
}

// --- Components ---

const RotationPreview = ({ imageUrl, className }: { imageUrl: string, className?: string }) => {
  const [frame, setFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  
  useEffect(() => {
    if (!isPlaying || isDragging) return;
    const interval = setInterval(() => {
      setFrame(prev => (prev + 1) % 8);
    }, 400);
    return () => clearInterval(interval);
  }, [isPlaying, isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartX(e.clientX);
    setIsPlaying(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const diff = e.clientX - startX;
    if (Math.abs(diff) > 20) {
      const direction = diff > 0 ? -1 : 1;
      setFrame(prev => (prev + direction + 8) % 8);
      setStartX(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    setStartX(e.touches[0].clientX);
    setIsPlaying(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const diff = e.touches[0].clientX - startX;
    if (Math.abs(diff) > 20) {
      const direction = diff > 0 ? -1 : 1;
      setFrame(prev => (prev + direction + 8) % 8);
      setStartX(e.touches[0].clientX);
    }
  };

  // Frame mapping for 4x2 grid:
  // Row 1: Front (0), Front-Left (1), Left (2), Back-Left (3)
  // Row 2: Back (4), Back-Right (5), Right (6), Front-Right (7)
  const positions = [
    '0% 0%', '33.33% 0%', '66.66% 0%', '100% 0%',
    '0% 100%', '33.33% 100%', '66.66% 100%', '100% 100%'
  ];
  
  const labels = [
    'Front View', 'Front-Left', 'Left Profile', 'Back-Left',
    'Back View', 'Back-Right', 'Right Profile', 'Front-Right'
  ];

  return (
    <div 
      className={cn("relative overflow-hidden rounded-2xl bg-stone-100 group cursor-grab active:cursor-grabbing", className)}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    >
      <div 
        className="w-full h-full bg-no-repeat transition-all duration-300 ease-linear pointer-events-none"
        style={{ 
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: '400% 200%',
          backgroundPosition: positions[frame]
        }}
      />
      
      {/* Controls Overlay */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/10 pointer-events-none" />
      
      <div className="absolute bottom-4 left-0 right-0 px-4 flex flex-col items-center gap-3 pointer-events-none">
        <div className="px-3 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10 shadow-xl">
          <p className="text-[10px] font-black text-white uppercase tracking-widest min-w-[80px] text-center">
            {labels[frame]}
          </p>
        </div>
        
        <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-2xl border border-stone-200 pointer-events-auto">
          <button 
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-600"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          
          <div className="flex gap-1 px-2">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
              <button
                key={i}
                onClick={() => {
                  setFrame(i);
                  setIsPlaying(false);
                }}
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-all",
                  frame === i ? "bg-emerald-500 w-4" : "bg-stone-300 hover:bg-stone-400"
                )} 
              />
            ))}
          </div>
          
          <button 
            onClick={() => {
              setFrame(prev => (prev + 1) % 8);
              setIsPlaying(false);
            }}
            className="p-2 hover:bg-stone-100 rounded-xl transition-colors text-stone-600"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="absolute top-4 right-4 pointer-events-none">
        <div className="px-2 py-1 bg-emerald-500 text-white text-[8px] font-black uppercase tracking-widest rounded-md shadow-lg">
          3D 360° View
        </div>
      </div>
      
      <div className="absolute top-4 left-4 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="px-2 py-1 bg-black/40 backdrop-blur-sm text-white text-[8px] font-medium rounded-md">
          Drag to Rotate
        </div>
      </div>
    </div>
  );
};

const BeforeAfterSlider = ({ before, after, className }: { before: string; after: string; className?: string }) => {
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const position = ((x - rect.left) / rect.width) * 100;
    setSliderPos(Math.min(Math.max(position, 0), 100));
  };

  return (
    <div 
      ref={containerRef}
      className={cn("relative aspect-square w-full overflow-hidden cursor-ew-resize select-none", className)}
      onMouseMove={handleMove}
      onTouchMove={handleMove}
    >
      <img src={after} alt="After" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
      <div 
        className="absolute inset-0 w-full h-full overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
      >
        <img src={before} alt="Before" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
      </div>
      <div 
        className="absolute inset-y-0 w-1 bg-white shadow-lg flex items-center justify-center"
        style={{ left: `${sliderPos}%` }}
      >
        <div className="w-8 h-8 bg-white rounded-full shadow-xl flex items-center justify-center -translate-x-1/2">
          <div className="flex gap-0.5">
            <div className="w-0.5 h-3 bg-stone-300 rounded-full" />
            <div className="w-0.5 h-3 bg-stone-300 rounded-full" />
          </div>
        </div>
      </div>
      <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-widest">Original</div>
      <div className="absolute top-4 right-4 bg-emerald-500/80 backdrop-blur-md text-white text-[10px] font-bold px-2 py-1 rounded-lg uppercase tracking-widest">AI Result</div>
    </div>
  );
};

const BarberLocator = ({ onBook }: { onBook: (barber: any) => void }) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const [barbers, setBarbers] = useState<google.maps.places.Place[]>([]);
  const [center, setCenter] = useState({ lat: 37.42, lng: -122.08 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const newCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(newCenter);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, []);

  useEffect(() => {
    if (!placesLib || !map || loading) return;
    placesLib.Place.searchNearby({
      locationRestriction: { center, radius: 5000 },
      includedPrimaryTypes: ['barber_shop', 'beauty_salon'],
      fields: ['displayName', 'location', 'formattedAddress', 'rating', 'userRatingCount'],
      maxResultCount: 15,
    }).then(({ places }) => setBarbers(places));
  }, [placesLib, map, center, loading]);

  const API_KEY = process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  
  if (!API_KEY) {
    return (
      <div className="h-[400px] w-full bg-stone-100 rounded-3xl flex flex-col items-center justify-center p-8 text-center gap-4 border-2 border-dashed border-stone-200">
        <MapPin className="w-12 h-12 text-stone-300" />
        <div className="space-y-1">
          <h3 className="font-bold text-stone-900">Google Maps API Key Required</h3>
          <p className="text-xs text-stone-500 max-w-xs">Please add GOOGLE_MAPS_PLATFORM_KEY to your secrets to enable the Barber Locator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-[400px] w-full rounded-3xl overflow-hidden shadow-inner border border-stone-200 relative">
        <APIProvider apiKey={API_KEY}>
          <Map
            defaultCenter={center}
            defaultZoom={13}
            mapId="BARBER_LOCATOR_MAP"
            {...({ internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'] } as any)}
            style={{ width: '100%', height: '100%' }}
          >
            {barbers.map((barber) => (
              <AdvancedMarker key={barber.id} position={barber.location}>
                <Pin background="#10b981" glyphColor="#fff" borderColor="#065f46" />
              </AdvancedMarker>
            ))}
            <AdvancedMarker position={center}>
              <Pin background="#3b82f6" glyphColor="#fff" />
            </AdvancedMarker>
          </Map>
        </APIProvider>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {barbers.map((barber) => (
          <div key={barber.id} className="p-4 bg-white rounded-2xl border border-stone-100 shadow-sm hover:shadow-md transition-all group">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-bold text-stone-900 group-hover:text-emerald-600 transition-colors">{barber.displayName}</h4>
              {barber.rating && (
                <div className="flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg text-[10px] font-bold">
                  ⭐ {barber.rating}
                </div>
              )}
            </div>
            <p className="text-xs text-stone-500 line-clamp-1 mb-3">{barber.formattedAddress}</p>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${barber.location?.lat},${barber.location?.lng}`, '_blank')}
                className="py-2 bg-stone-50 text-stone-600 rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-stone-100 transition-all flex items-center justify-center gap-2"
              >
                <MapPin className="w-3 h-3" />
                Directions
              </button>
              <button 
                onClick={() => onBook(barber)}
                className="py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 shadow-sm"
              >
                <Calendar className="w-3 h-3" />
                Book Now
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-red-100 text-center">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-stone-900 mb-2">Something went wrong</h2>
            <p className="text-stone-500 mb-6 text-sm">We encountered an unexpected error. Please try refreshing the page.</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-stone-900 text-white rounded-xl font-semibold hover:bg-stone-800 transition-colors"
            >
              Refresh Page
            </button>
            {(import.meta as any).env.DEV && (
              <pre className="mt-4 p-3 bg-stone-50 rounded-lg text-[10px] text-left overflow-auto max-h-32 text-stone-400">
                {this.state.errorInfo}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Firestore Error Handler ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Utils ---
const compressImage = (base64Str: string, maxWidth = 800, maxHeight = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(base64Str); // Fallback to original if error
  });
};

// --- Main App Component ---

function HairStyleApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string>('Global');
  const [selectedStyle, setSelectedStyle] = useState<string>('AI Recommended');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [barberTalkSuggestions, setBarberTalkSuggestions] = useState<{[key: string]: string}>({});
  const [bestFitPrompt, setBestFitPrompt] = useState<string | null>(null);
  const [targetPerson, setTargetPerson] = useState<string>('the person');
  const [detectedPersons, setDetectedPersons] = useState<string[]>([]);
  const [showCamera, setShowCamera] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [flash, setFlash] = useState(false);
  const [showCareTips, setShowCareTips] = useState(false);
  const [selectedComparison, setSelectedComparison] = useState<Generation | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedPreferences, setSavedPreferences] = useState<SavedPreference[]>([]);
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceName, setPreferenceName] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);
  
  // --- New Feature States ---
  const [scalpAnalysis, setScalpAnalysis] = useState<{
    healthScore: number;
    concerns: string[];
    recommendations: string[];
    analysis: string;
  } | null>(null);
  const [analyzingScalp, setAnalyzingScalp] = useState(false);
  const [weatherTips, setWeatherTips] = useState<{
    condition: string;
    temp: number;
    humidity: number;
    tips: string[];
  } | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedBarberForBooking, setSelectedBarberForBooking] = useState<any>(null);
  const [isVirtualTryOn, setIsVirtualTryOn] = useState(false);
  const [isColorSimulation, setIsColorSimulation] = useState(false);
  const [simulationColor, setSimulationColor] = useState<string>('#4a2c2a'); // Default dark brown
  const [simulationStyle, setSimulationStyle] = useState<string>('');
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<string | null>(null);
  const [currentBarberTalk, setCurrentBarberTalk] = useState<string | null>(null);
  // New Features State
  const [activeTab, setActiveTab] = useState<'studio' | 'analysis' | 'locator' | 'chat' | 'growth'>('studio');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [growthLogs, setGrowthLogs] = useState<GrowthLog[]>([]);
  const [isUploadingGrowth, setIsUploadingGrowth] = useState(false);
  const [faceAnalysis, setFaceAnalysis] = useState<{
    shape: string;
    description: string;
    recommendations: string[];
    characteristics: string[];
    bestStyles: string[];
    shirtRecommendation?: string;
    pantRecommendation?: string;
  } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [showBeforeAfter, setShowBeforeAfter] = useState(false);
  const [recommendedImages, setRecommendedImages] = useState<{style: string, url: string, barberTalk: string}[]>([]);
  const [generatingRecommendations, setGeneratingRecommendations] = useState(false);
  const [showKeySelection, setShowKeySelection] = useState(false);
  const [hasUserKey, setHasUserKey] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [is360Mode, setIs360Mode] = useState(false);
  const [isAvatarMode, setIsAvatarMode] = useState(false);
  const [isResult360, setIsResult360] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>(['hair']);
  const [multiPhotos, setMultiPhotos] = useState<{ front?: string; left?: string; right?: string; back?: string }>({});
  const [isMultiCapture, setIsMultiCapture] = useState(false);
  const [currentCaptureStep, setCurrentCaptureStep] = useState<'front' | 'left' | 'right' | 'back'>('front');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const hairStyles = [
    { name: 'AI Recommended', prompt: 'the most flattering hairstyle based on AI analysis', country: 'Global' },
    { name: 'Short Fade', prompt: 'a clean short fade haircut', country: 'Global' },
    { name: 'Long Waves', prompt: 'long wavy flowing hair', country: 'Global' },
    { name: 'Buzz Cut', prompt: 'a sharp buzz cut', country: 'Global' },
    { name: 'Pompadour', prompt: 'a classic pompadour hairstyle', country: 'Global' },
    { name: 'Curly Top', prompt: 'short sides with curly top hair', country: 'Global' },
    { name: 'Man Bun', prompt: 'a stylish man bun', country: 'Global' },
    { name: 'Pixie Cut', prompt: 'a modern pixie haircut', country: 'Global' },
    { name: 'Bob Cut', prompt: 'a sleek bob haircut', country: 'Global' },
    { name: 'Wolf Cut', prompt: 'a trendy wolf cut with shaggy layers and curtain bangs', country: 'Global' },
    
    // India Specific
    { name: 'South Indian Silk', prompt: 'traditional South Indian long braided hair with jasmine flowers', country: 'India' },
    { name: 'Bollywood Waves', prompt: 'glamorous Bollywood style voluminous waves', country: 'India' },
    { name: 'Desi Crew Cut', prompt: 'a sharp crew cut popular in Indian urban areas', country: 'India' },
    { name: 'Sikh Turban Style', prompt: 'a neatly tied traditional Sikh turban', country: 'India' },
    { name: 'Indian Shag', prompt: 'a modern shaggy haircut tailored for thick Indian hair', country: 'India' },
    { name: 'Classic Side Part', prompt: 'a neat classic side part popular in Indian formal settings', country: 'India' },
    
    // US Specific
    { name: 'California Surf', prompt: 'sun-kissed messy beach waves', country: 'USA' },
    { name: 'NYC Slick Back', prompt: 'a sharp high-shine slicked back look', country: 'USA' },
    { name: 'Brooklyn Fade', prompt: 'a precise skin fade with a textured top', country: 'USA' },
    
    // Korea Specific
    { name: 'K-Pop Mullet', prompt: 'a stylish modern K-pop inspired mullet', country: 'Korea' },
    { name: 'Two-Block Cut', prompt: 'a classic Korean two-block haircut', country: 'Korea' },
    { name: 'See-Through Bangs', prompt: 'delicate Korean see-through bangs', country: 'Korea' },

    // Facial Hair
    { name: 'Full Beard', prompt: 'a thick full beard', country: 'Global' },
    { name: 'Circle Beard', prompt: 'a circle beard with moustache', country: 'Global' },
    { name: 'Handlebar', prompt: 'a handlebar moustache', country: 'Global' },
    { name: 'Stubble', prompt: 'heavy stubble beard', country: 'Global' },
  ];

  const filteredStyles = hairStyles.filter(style => 
    selectedCountry === 'Global' || style.country === 'Global' || style.country === selectedCountry
  );

  const careTips = [
    { element: 'Biotin (Vitamin B7)', tip: 'Essential for keratin production, which is the primary protein in hair.' },
    { element: 'Zinc', tip: 'Helps maintain the oil-secreting glands around the hair follicles.' },
    { element: 'Iron', tip: 'Helps red blood cells carry oxygen to your cells, including hair follicles.' },
    { element: 'Vitamin C', tip: 'A powerful antioxidant that helps protect against oxidative stress and aids collagen production.' },
    { element: 'Vitamin D', tip: 'Low levels are linked to alopecia; it helps create new follicles.' },
    { element: 'Omega-3 Fatty Acids', tip: 'Provides essential proteins and nutrients to hair follicles and skin.' },
    { element: 'Protein', tip: 'Hair is made of protein; adequate intake is crucial for growth.' },
  ];

  // --- Firebase Auth ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // --- API Key Check ---
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasUserKey(hasKey);
      }
    };
    checkKey();
  }, []);

  // --- Connection Test ---
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
          console.log("Firebase connection successful.");
        } catch (error) {
          console.error("Firebase connection test failed:", error);
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
            setError("Firebase connection error. Please check your configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  // --- Firestore Real-time Updates ---
  useEffect(() => {
    if (!user) return;

    const path = 'generations';
    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = new Date();
      const docs = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Generation))
        .filter(gen => {
          const isExpired = new Date(gen.expiresAt) <= now;
          if (isExpired) {
            deleteDoc(doc(db, 'generations', gen.id)).catch(err => handleFirestoreError(err, OperationType.DELETE, `generations/${gen.id}`));
            return false;
          }
          return true;
        });
      
      setGenerations(docs);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setSavedPreferences([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'preferences'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const prefs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SavedPreference[];
      setSavedPreferences(prefs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/preferences`);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) {
      setGrowthLogs([]);
      return;
    }

    const q = query(
      collection(db, 'users', user.uid, 'growth_logs'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as GrowthLog[];
      setGrowthLogs(logs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/growth_logs`);
    });

    return () => unsubscribe();
  }, [user]);

  const handleGrowthUpload = async (file: File) => {
    if (!user) return;

    setIsUploadingGrowth(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        const logId = doc(collection(db, 'users', user.uid, 'growth_logs')).id;
        const newLog: GrowthLog = {
          id: logId,
          userId: user.uid,
          imageUrl: base64,
          notes: '',
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'users', user.uid, 'growth_logs', logId), newLog);
        setIsUploadingGrowth(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(`Failed to upload growth log: ${err.message}`);
      setIsUploadingGrowth(false);
    }
  };

  const handleDeleteGrowthLog = async (logId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'growth_logs', logId));
    } catch (err: any) {
      setError(`Failed to delete growth log: ${err.message}`);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);
    setError(null);

    try {
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
      const ai = new GoogleGenAI({ apiKey });
      const response = await retry(() => ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [...chatMessages, userMsg].map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
        config: {
          systemInstruction: "You are an expert AI Hair Stylist. Answer questions about hairstyles, hair care, face shapes, and grooming. Be professional, encouraging, and concise."
        }
      }));

      const aiMsg: ChatMessage = { role: 'model', text: response.text || "I'm sorry, I couldn't process that." };
      setChatMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      const { message, isQuota, isAuth } = handleGenAIError(err);
      if (isAuth) {
        setError("API Key error. The current key is invalid or doesn't have access to this model.");
        setShowKeySelection(true);
      } else if (isQuota) {
        setError("AI service is currently busy (quota exceeded). You can try again in a few minutes, or select your own paid API key for higher limits.");
        setShowKeySelection(true);
      } else {
        setError(`Chat failed: ${message}`);
      }
    } finally {
      setIsChatLoading(false);
    }
  };

  const getProductRecommendations = async (style: string) => {
    try {
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
      const ai = new GoogleGenAI({ apiKey });
      const response = await retry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Recommend 3 hair products for maintaining a ${style} hairstyle. Return as JSON array of objects with name, description, reason, and category.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                reason: { type: Type.STRING },
                category: { type: Type.STRING }
              },
              required: ["name", "description", "reason", "category"]
            }
          }
        }
      }));
      const data = JSON.parse(response.text || "[]");
      setProducts(data);
    } catch (err: any) {
      const { message, isQuota } = handleGenAIError(err);
      if (!isQuota) {
        toast.error(`Could not get custom product recommendations: ${message}`);
      }
      // Fallback products if API fails
      const fallbackProducts = [
        { name: "Hydrating Shampoo", description: "Moisturizing shampoo for all hair types.", reason: "Maintains hair health and shine.", category: "Cleansing" },
        { name: "Argan Oil", description: "Pure argan oil for hair nourishment.", reason: "Reduces frizz and adds smoothness.", category: "Treatment" },
        { name: "Sea Salt Spray", description: "Texturizing spray for natural waves.", reason: "Adds volume and definition.", category: "Styling" }
      ];
      setProducts(fallbackProducts);
    }
  };

  const handleSavePreference = async () => {
    if (!user || !preferenceName.trim()) return;
    setSavingPreference(true);
    try {
      const prefId = doc(collection(db, 'users', user.uid, 'preferences')).id;
      const newPref: SavedPreference = {
        id: prefId,
        userId: user.uid,
        name: preferenceName.trim(),
        styleName: selectedStyle,
        customPrompt: customPrompt,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'users', user.uid, 'preferences', prefId), newPref);
      setPreferenceName('');
      setShowSaveModal(false);
    } catch (err: any) {
      setError(`Failed to save preference: ${err.message}`);
    } finally {
      setSavingPreference(false);
    }
  };

  const handleDeletePreference = async (prefId: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'preferences', prefId));
    } catch (err: any) {
      setError(`Failed to delete preference: ${err.message}`);
    }
  };

  const handleLoadPreference = (pref: SavedPreference) => {
    setSelectedStyle(pref.styleName);
    setCustomPrompt(pref.customPrompt);
  };

  // --- Handlers ---
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error(err);
      setError("Login failed.");
    }
  };

  const handleLogout = () => signOut(auth);

  const handleCopyPrompt = () => {
    if (pendingPrompt) {
      navigator.clipboard.writeText(pendingPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        setSelectedImage(compressed);
        setSuggestions([]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReferenceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const compressed = await compressImage(reader.result as string);
        setReferenceImage(compressed);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async (mode: 'user' | 'environment' = facingMode) => {
    setShowCamera(true);
    setFacingMode(mode);
    
    // Stop any existing tracks before starting new ones
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: mode } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error(err);
      setError("Camera access denied or not available.");
      setShowCamera(false);
    }
  };

  const toggleCamera = () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFlash(false); // Reset flash when switching cameras
    startCamera(newMode);
  };

  const toggleFlash = async () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      const track = stream.getVideoTracks()[0];
      
      try {
        const capabilities = track.getCapabilities() as any;
        if (capabilities.torch) {
          const newFlash = !flash;
          await track.applyConstraints({
            advanced: [{ torch: newFlash }]
          } as any);
          setFlash(newFlash);
        } else {
          toast.error("Flash is not supported on this camera.");
        }
      } catch (err) {
        console.error("Error toggling flash:", err);
        toast.error("Failed to toggle flash.");
      }
    }
  };

  const capturePhoto = async () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        const width = videoRef.current.videoWidth;
        const height = videoRef.current.videoHeight;
        canvasRef.current.width = width;
        canvasRef.current.height = height;
        
        if (facingMode === 'user') {
          context.translate(width, 0);
          context.scale(-1, 1);
        }
        
        context.drawImage(videoRef.current, 0, 0, width, height);
        const dataUrl = canvasRef.current.toDataURL('image/png');
        const compressed = await compressImage(dataUrl);
        
        if (isMultiCapture) {
          setMultiPhotos(prev => ({ ...prev, [currentCaptureStep]: compressed }));
          
          // Advance to next step or finish
          if (currentCaptureStep === 'front') setCurrentCaptureStep('left');
          else if (currentCaptureStep === 'left') setCurrentCaptureStep('right');
          else if (currentCaptureStep === 'right') setCurrentCaptureStep('back');
          else {
            // All 4 captured
            setSelectedImage(compressed); // Use the last one as the main preview for now
            setSuggestions([]);
            stopCamera();
            setIsMultiCapture(false);
          }
        } else {
          setSelectedImage(compressed);
          setSuggestions([]);
          stopCamera();
        }
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setFlash(false);
    setShowCamera(false);
  };

  // --- New Feature Handlers ---

  const handleAnalyzeScalp = async () => {
    if (!selectedImage) return;
    setAnalyzingScalp(true);
    setError(null);
    try {
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
      const ai = new GoogleGenAI({ apiKey });
      
      const base64Data = selectedImage.split(',')[1];
      const response = await retry(() => ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
            { text: "Analyze the scalp health in this image. Provide a health score (0-100), list concerns, and give recommendations. Return the response in JSON format with fields: healthScore (number), concerns (array of strings), recommendations (array of strings), analysis (string)." }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              healthScore: { type: Type.NUMBER },
              concerns: { type: Type.ARRAY, items: { type: Type.STRING } },
              recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
              analysis: { type: Type.STRING }
            },
            required: ["healthScore", "concerns", "recommendations", "analysis"]
          }
        }
      }));

      const result = JSON.parse(response.text);
      setScalpAnalysis(result);
    } catch (err: any) {
      const { message, isQuota, isAuth } = handleGenAIError(err);
      if (isAuth) {
        setError("API Key error. The current key is invalid or doesn't have access to this model.");
        setShowKeySelection(true);
      } else if (isQuota) {
        setError("AI service is currently busy (quota exceeded). You can try again in a few minutes, or select your own paid API key for higher limits.");
        setShowKeySelection(true);
      } else {
        setError(`Failed to analyze scalp health: ${message}`);
      }
    } finally {
      setAnalyzingScalp(false);
    }
  };

  const handleSimulate = async () => {
    if (!selectedImage) return;
    setIsSimulating(true);
    setError(null);
    try {
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
      const ai = new GoogleGenAI({ apiKey });
      
      const base64Data = selectedImage.split(',')[1];
      const prompt = isColorSimulation 
        ? `Simulate a hair color change to ${simulationColor} on the person in this image. Keep the same hairstyle but change the color accurately.`
        : `Simulate a virtual try-on of a ${simulationStyle} hairstyle on the person in this image. Blend it naturally with their face.`;

      const response = await retry(() => ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: {
          parts: [
            { inlineData: { data: base64Data, mimeType: "image/jpeg" } },
            { text: prompt }
          ]
        }
      }));

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          setSimulationResult(`data:image/png;base64,${part.inlineData.data}`);
          break;
        }
      }
    } catch (err: any) {
      const { message, isQuota, isAuth } = handleGenAIError(err);
      if (isAuth) {
        setError("API Key error. The current key is invalid or doesn't have access to this model.");
        setShowKeySelection(true);
      } else if (isQuota) {
        setError("AI service is currently busy (quota exceeded). You can try again in a few minutes, or select your own paid API key for higher limits.");
        setShowKeySelection(true);
      } else {
        setError(`Simulation failed: ${message}`);
      }
    } finally {
      setIsSimulating(false);
    }
  };

  useEffect(() => {
    const fetchWeatherTips = async () => {
      if (!user) return;
      try {
        // Mock weather data for now, or use a real API if available
        const mockWeather = { condition: 'Sunny', temp: 28, humidity: 65 };
        
        const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
        const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
        const ai = new GoogleGenAI({ apiKey });
        
        const response = await retry(() => ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Given the weather is ${mockWeather.condition} with ${mockWeather.temp}°C and ${mockWeather.humidity}% humidity, provide 3 short hair care tips. Return as JSON: tips (array of strings).`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                tips: { type: Type.ARRAY, items: { type: Type.STRING } }
              },
              required: ["tips"]
            }
          }
        }));
        
        const result = JSON.parse(response.text);
        setWeatherTips({ ...mockWeather, tips: result.tips });
      } catch (err: any) {
        const isQuotaError = err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED");
        if (!isQuotaError) {
          console.error("Weather tips error:", err);
        }
        // Fallback tips if API fails (e.g., quota exceeded)
        const fallbackTips = [
          "Keep your hair hydrated with a leave-in conditioner.",
          "Protect your hair from UV rays with a hat or SPF spray.",
          "Avoid excessive heat styling on sunny days."
        ];
        const mockWeather = { condition: 'Sunny', temp: 28, humidity: 65 };
        setWeatherTips({ ...mockWeather, tips: fallbackTips });
      }
    };
    fetchWeatherTips();
  }, [user]);

  const handleBookAppointment = (barber: any) => {
    setSelectedBarberForBooking(barber);
    setIsBookingModalOpen(true);
  };

  const generateRecommendedStyles = async (styles: string[], barberTalkMap: Record<string, string>, target: string) => {
    if (!selectedImage) return;
    setGeneratingRecommendations(true);
    setRecommendedImages([]);
    
    try {
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
      const ai = new GoogleGenAI({ apiKey });
      const base64Data = selectedImage.split(',')[1];

      const results = [];
      for (const style of styles.slice(0, 3)) {
        const prompt = `Apply a ${style} to ${target} in this image. 
        CRITICAL INSTRUCTION: The face of ${target} MUST be matched 100% to the original image. 
        The facial features, skin tone, eyes, nose, and expression of ${target} must remain IDENTICAL. 
        Only the hair of ${target} should be modified. 
        The output must be a professional, high-quality realistic photograph.`;

        try {
          const response = await retry(() => ai.models.generateContent({
            model: "gemini-2.5-flash-image",
            contents: {
              parts: [
                { inlineData: { data: base64Data, mimeType: "image/png" } },
                { text: prompt }
              ]
            },
            config: {
              imageConfig: {
                aspectRatio: "1:1",
                imageSize: "1K"
              }
            }
          }));

          let url = '';
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              url = `data:image/png;base64,${part.inlineData.data}`;
              break;
            }
          }
          
          if (url) {
            results.push({ style, url, barberTalk: barberTalkMap[style] || "" });
          }
        } catch (e) {
          console.error(`Failed to generate image for style ${style}:`, e);
        }
      }

      setRecommendedImages(results);
    } catch (err: any) {
      const { message, isQuota, isAuth } = handleGenAIError(err);
      if (isAuth) {
        setError("API Key error. The current key is invalid or doesn't have access to this model.");
        setShowKeySelection(true);
      } else if (isQuota) {
        setError("AI service is currently busy (quota exceeded). You can try again in a few minutes, or select your own paid API key for higher limits.");
        setShowKeySelection(true);
      }
    } finally {
      setGeneratingRecommendations(false);
    }
  };

  const handleSuggestStyles = async () => {
    if (!selectedImage) return;
    setAnalyzing(true);
    setError(null);
    setAnalysisResult(null);
    setDetectedPersons([]);
    setTargetPerson('the person');
    try {
      // Create a new instance right before making an API call to ensure it uses the most up-to-date API key
      // Prefer process.env.API_KEY (selected by user) over process.env.GEMINI_API_KEY (default)
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';
      
      if (!apiKey) {
        setError("No API key found. Please ensure your Gemini API key is correctly configured.");
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      
      // Compress image even more for analysis to reduce latency
      const analysisImage = await compressImage(selectedImage, 512, 512, 0.5);
      const base64Data = analysisImage.split(',')[1];
      
      // Try stable models
      const modelsToTry = ["gemini-2.5-flash"];
      
      let lastError = null;
      let response = null;

      for (const model of modelsToTry) {
        try {
          response = await retry(() => ai.models.generateContent({
            model,
            contents: {
              parts: [
                { inlineData: { data: base64Data, mimeType: "image/png" } },
                { text: "Analyze this image. First, detect how many people are in the image and provide a short descriptive label for each (e.g., 'the person on the left', 'the person in the middle', 'the person on the right'). Then, for the most prominent person (or the first one), analyze their face shape, facial features, and hairline. Recommend 3 specific hairstyles that would be most flattering. For each recommendation, provide 'barber_talk' which is a short instruction for a barber in 'Tanglish' (a mix of Telugu and English as spoken by Telugu people, e.g., 'Sides lo fade chesi, top lo konchem length maintain cheyandi'). Also, provide a 'best_fit_prompt' which is a detailed description of the single best hairstyle for them. Additionally, recommend a specific type of shirt and pant (color and style) that would complement their look and the recommended hairstyles. Return the response in JSON format." }
              ]
            },
            config: {
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  persons: { type: Type.ARRAY, items: { type: Type.STRING } },
                  analysis: { type: Type.STRING },
                  recommendations: { type: Type.ARRAY, items: { type: Type.STRING } },
                  barber_talk_map: { 
                    type: Type.OBJECT, 
                    description: "A map where keys are the style names and values are the Tanglish instructions for the barber."
                  },
                  best_fit_prompt: { type: Type.STRING },
                  face_shape: { type: Type.STRING },
                  characteristics: { type: Type.ARRAY, items: { type: Type.STRING } },
                  best_styles: { type: Type.ARRAY, items: { type: Type.STRING } },
                  shirt_recommendation: { type: Type.STRING },
                  pant_recommendation: { type: Type.STRING }
                },
                required: ["persons", "analysis", "recommendations", "barber_talk_map", "best_fit_prompt", "face_shape", "characteristics", "best_styles", "shirt_recommendation", "pant_recommendation"]
              }
            }
          }));
          if (response) break;
        } catch (e) {
          console.warn(`Failed with model ${model}:`, e);
          lastError = e;
        }
      }

      if (!response) throw lastError;

      const result = JSON.parse(response.text || '{}');
      if (!result.recommendations || !result.analysis) {
        throw new Error("AI returned an incomplete analysis. Please try again.");
      }
      
      // Update Face Analysis Dashboard
      setFaceAnalysis({
        shape: result.face_shape || "Unknown",
        description: result.analysis || "",
        recommendations: result.recommendations || [],
        characteristics: result.characteristics || [],
        bestStyles: result.best_styles || [],
        shirtRecommendation: result.shirt_recommendation,
        pantRecommendation: result.pant_recommendation
      });

      setAnalysisResult(result.analysis || null);
      setSuggestions(result.recommendations || []);
      setBarberTalkSuggestions(result.barber_talk_map || {});
      setBestFitPrompt(result.best_fit_prompt || null);
      setDetectedPersons(result.persons || []);
      if (result.persons?.length > 0) {
        setTargetPerson(result.persons[0]);
      }
      if (result.recommendations?.length > 0) {
        setSelectedStyle('AI Recommended');
        // Generate images for the 3 recommended styles
        generateRecommendedStyles(result.recommendations, result.barber_talk_map || {}, result.persons?.[0] || 'the person');
      }
    } catch (err: any) {
      const { message, isQuota, isAuth } = handleGenAIError(err);
      let finalMessage = message;
      
      if (finalMessage.includes("Unexpected token") || finalMessage.includes("JSON")) {
        finalMessage = "The AI returned a malformed response. This can happen with complex images. Please try again with a clearer photo.";
      }

      if (isAuth) {
        setError("API Key error. The current key is invalid or doesn't have access to this model.");
        setShowKeySelection(true);
      } else if (isQuota) {
        setError("AI service is currently busy (quota exceeded). You can try again in a few minutes, or select your own paid API key for higher limits.");
        setShowKeySelection(true);
      } else {
        setError(`Analysis failed: ${finalMessage}`);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMultiPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, angle: 'front' | 'left' | 'right' | 'back') => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const dataUrl = event.target?.result as string;
        const compressed = await compressImage(dataUrl);
        setMultiPhotos(prev => ({ ...prev, [angle]: compressed }));
        toast.success(`${angle.charAt(0).toUpperCase() + angle.slice(1)} view uploaded successfully.`);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerate = async () => {
    if (!selectedImage || !user) return;

    let stylePrompt = '';
    const featuresToModify = selectedFeatures.join(' and ');
    
    if (referenceImage) {
      stylePrompt = `EXACTLY the ${featuresToModify}, texture, and length shown in the second image (the model reference photo)`;
    } else if (selectedStyle === 'AI Recommended' && bestFitPrompt) {
      stylePrompt = bestFitPrompt;
    } else {
      stylePrompt = hairStyles.find(s => s.name === selectedStyle)?.prompt || selectedStyle;
    }

    if (isAvatarMode) {
      stylePrompt = `a high-quality 3D animated movie style avatar version of ${stylePrompt}`;
    }

    const finalPrompt = `Apply ${stylePrompt} to ${targetPerson} in the first image (IMAGE 1). 
    ${(multiPhotos.front || multiPhotos.left || multiPhotos.right || multiPhotos.back) ? `I have provided additional reference views of the same person:
    ${multiPhotos.front ? "- IMAGE 2: Front view" : ""}
    ${multiPhotos.left ? `- IMAGE ${multiPhotos.front ? 3 : 2}: Left view` : ""}
    ${multiPhotos.right ? `- IMAGE ${[multiPhotos.front, multiPhotos.left].filter(Boolean).length + 2}: Right view` : ""}
    ${multiPhotos.back ? `- IMAGE ${[multiPhotos.front, multiPhotos.left, multiPhotos.right].filter(Boolean).length + 2}: Back view` : ""}
    Use these additional views to perfectly understand their head shape, facial features, and current hair from all angles.` : ""}
    CRITICAL INSTRUCTION: The face of ${targetPerson} MUST be matched 100% to the original image (IMAGE 1). 
    The facial features, skin tone, eyes, nose, and expression of ${targetPerson} must remain IDENTICAL. 
    Only the ${featuresToModify} of ${targetPerson} should be modified. 
    The output must be a professional, high-quality, high-resolution realistic photograph. 
    Ensure the lighting and background blend seamlessly. ${customPrompt}`;

    let promptToUse = finalPrompt;

    if (referenceImage) {
      const multiCount = [multiPhotos.front, multiPhotos.left, multiPhotos.right, multiPhotos.back].filter(Boolean).length;
      const refIdx = multiCount + 2;
      promptToUse = `I have provided multiple images. 
      IMAGE 1 (Target): The person who needs a new look. 
      ${(multiPhotos.front || multiPhotos.left || multiPhotos.right || multiPhotos.back) ? `Additional Reference Views of Target:
      ${multiPhotos.front ? "- IMAGE 2: Front view" : ""}
      ${multiPhotos.left ? `- IMAGE ${multiPhotos.front ? 3 : 2}: Left view` : ""}
      ${multiPhotos.right ? `- IMAGE ${[multiPhotos.front, multiPhotos.left].filter(Boolean).length + 2}: Right view` : ""}
      ${multiPhotos.back ? `- IMAGE ${[multiPhotos.front, multiPhotos.left, multiPhotos.right].filter(Boolean).length + 2}: Back view` : ""}` : ""}
      IMAGE ${refIdx} (Source): The model with the desired ${featuresToModify}.
      
      Your task is to extract the EXACT ${featuresToModify}, texture, length, and color from IMAGE ${refIdx} and apply it perfectly to the person in IMAGE 1. 
      ${isAvatarMode ? "IMPORTANT: Transform the final result into a high-quality 3D animated movie style avatar (Pixar/Disney style)." : ""}
      
      CRITICAL CONSTRAINTS:
      1. The face, facial features, skin tone, and expression of the person in IMAGE 1 must remain 100% UNCHANGED and IDENTICAL (or a faithful avatar version of them). 
      2. The only change should be the ${featuresToModify}, which must be replaced with the features from IMAGE ${refIdx}. 
      3. The final result must look like a real, professional photograph (or high-quality 3D render if avatar mode is on) of the person from IMAGE 1 with the new ${featuresToModify}. 
      4. Do not return any of the input images as is. You must generate a new image that combines them as described. ${customPrompt}`;
    }

    if (is360Mode) {
      if (referenceImage) {
        const multiCount = [multiPhotos.front, multiPhotos.left, multiPhotos.right, multiPhotos.back].filter(Boolean).length;
        const refIdx = multiCount + 2;
        promptToUse = `I have provided multiple images. 
        IMAGE 1 (Target): The person who needs a new look. 
        ${(multiPhotos.front || multiPhotos.left || multiPhotos.right || multiPhotos.back) ? `Additional Reference Views of Target:
        ${multiPhotos.front ? "- IMAGE 2: Front view" : ""}
        ${multiPhotos.left ? `- IMAGE ${multiPhotos.front ? 3 : 2}: Left view` : ""}
        ${multiPhotos.right ? `- IMAGE ${[multiPhotos.front, multiPhotos.left].filter(Boolean).length + 2}: Right view` : ""}
        ${multiPhotos.back ? `- IMAGE ${[multiPhotos.front, multiPhotos.left, multiPhotos.right].filter(Boolean).length + 2}: Back view` : ""}` : ""}
        IMAGE ${refIdx} (Source): The model with the desired ${featuresToModify}.
        
        Generate a high-quality 8-view rotation collage (Front, Front-Left, Left, Back-Left, Back, Back-Right, Right, Front-Right) of the person from IMAGE 1 with the EXACT ${featuresToModify} shown in IMAGE ${refIdx}. 
        ${isAvatarMode ? "IMPORTANT: Transform all views into a high-quality 3D animated movie style avatar (Pixar/Disney style)." : ""}
        
        CRITICAL CONSTRAINTS:
        1. The face of the person across ALL 8 views must be 100% IDENTICAL and PERFECTLY MATCH the person in IMAGE 1 (or a faithful avatar version). 
        2. The facial features, bone structure, and skin tone must be perfectly consistent across all rotation angles. 
        3. The ${featuresToModify} must be consistent across all 8 views and match the features from IMAGE ${refIdx}. 
        4. The output should be a single image containing these 8 panels in a 4x2 grid. 
        5. Ensure professional lighting and a clean background for all views. ${customPrompt}`;
      } else {
        promptToUse = `Generate a high-quality 8-view rotation collage (Front, Front-Left, Left, Back-Left, Back, Back-Right, Right, Front-Right) of ${targetPerson} with ${stylePrompt}. 
        IMAGE 1 (Target): The main photo of ${targetPerson}.
        ${(multiPhotos.front || multiPhotos.left || multiPhotos.right || multiPhotos.back) ? `Additional Reference Views of Target:
        ${multiPhotos.front ? "- IMAGE 2: Front view" : ""}
        ${multiPhotos.left ? `- IMAGE ${multiPhotos.front ? 3 : 2}: Left view` : ""}
        ${multiPhotos.right ? `- IMAGE ${[multiPhotos.front, multiPhotos.left].filter(Boolean).length + 2}: Right view` : ""}
        ${multiPhotos.back ? `- IMAGE ${[multiPhotos.front, multiPhotos.left, multiPhotos.right].filter(Boolean).length + 2}: Back view` : ""}` : ""}
        ${isAvatarMode ? "IMPORTANT: Transform all views into a high-quality 3D animated movie style avatar (Pixar/Disney style)." : ""}
        CRITICAL: The face of ${targetPerson} across ALL 8 views must be 100% IDENTICAL and PERFECTLY MATCH the original person in IMAGE 1 (or a faithful avatar version). 
        The facial features, bone structure, and skin tone must be perfectly consistent across all rotation angles. 
        The ${featuresToModify} must be consistent across all 8 views. 
        The output should be a single image containing these 8 panels in a 4x2 grid. 
        Ensure professional lighting and a clean background for all views. ${customPrompt}`;
      }
    }

    setPendingPrompt(promptToUse);
    setShowPromptPreview(true);
  };

  const confirmGenerate = async () => {
    if (!selectedImage || !user || !pendingPrompt) return;

    setShowPromptPreview(false);
    setUploading(true);
    setError(null);
    
    // Get product recommendations in background
    getProductRecommendations(selectedStyle);

    try {
      // Create a new instance right before making an API call to ensure it uses the most up-to-date API key
      // Prefer process.env.API_KEY (selected by user) over process.env.GEMINI_API_KEY (default)
      const hasUserKey = !!process.env.API_KEY && process.env.API_KEY !== 'undefined' && process.env.API_KEY !== '';
      const apiKey = (hasUserKey ? process.env.API_KEY : process.env.GEMINI_API_KEY) || '';

      if (!apiKey) {
        setError("No API key found. Please ensure your Gemini API key is correctly configured.");
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const base64Data = selectedImage.split(',')[1];
      const mimeType = selectedImage.split(';')[0].split(':')[1] || 'image/jpeg';
      
      const parts: any[] = [
        { inlineData: { data: base64Data, mimeType } }
      ];

      // Add multi-photo context if available
      if (multiPhotos.front) parts.push({ inlineData: { data: multiPhotos.front.split(',')[1], mimeType: multiPhotos.front.split(';')[0].split(':')[1] || 'image/jpeg' } });
      if (multiPhotos.left) parts.push({ inlineData: { data: multiPhotos.left.split(',')[1], mimeType: multiPhotos.left.split(';')[0].split(':')[1] || 'image/jpeg' } });
      if (multiPhotos.right) parts.push({ inlineData: { data: multiPhotos.right.split(',')[1], mimeType: multiPhotos.right.split(';')[0].split(':')[1] || 'image/jpeg' } });
      if (multiPhotos.back) parts.push({ inlineData: { data: multiPhotos.back.split(',')[1], mimeType: multiPhotos.back.split(';')[0].split(':')[1] || 'image/jpeg' } });

      if (referenceImage) {
        const refBase64 = referenceImage.split(',')[1];
        const refMimeType = referenceImage.split(';')[0].split(':')[1] || 'image/jpeg';
        parts.push({ inlineData: { data: refBase64, mimeType: refMimeType } });
      }

      parts.push({ text: pendingPrompt });

      // Try stable models
      const modelsToTry = ["gemini-2.5-flash-image"];
      
      let lastError = null;
      let response = null;

      for (const model of modelsToTry) {
        try {
          response = await retry(() => ai.models.generateContent({
            model,
            contents: {
              parts
            },
            config: {
              imageConfig: {
                aspectRatio: "1:1",
                imageSize: "1K"
              }
            }
          }));
          if (response) break;
        } catch (e) {
          console.warn(`Failed with model ${model}:`, e);
          lastError = e;
        }
      }

      if (!response) throw lastError;

      let generatedImageUrl = '';
      let aiTextResponse = '';

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          generatedImageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        } else if (part.text) {
          aiTextResponse += part.text;
        }
      }

      if (!generatedImageUrl) {
        if (aiTextResponse) {
          throw new Error(`AI could not generate image: ${aiTextResponse}`);
        }
        throw new Error("No image generated by AI. The model might have rejected the prompt due to safety filters or technical issues.");
      }

      setIsResult360(is360Mode);
      
      // Compress images before saving to Firestore to avoid 1MB limit
      const [compressedOriginal, compressedGenerated] = await Promise.all([
        compressImage(selectedImage, 800, 800, 0.6),
        compressImage(generatedImageUrl, 800, 800, 0.6)
      ]);

      // Generate Barber Talk for the final result
      let finalBarberTalk = "";
      try {
        const textAi = new GoogleGenAI({ apiKey });
        const talkResponse = await retry(() => textAi.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Based on this hairstyle description: "${pendingPrompt}", provide a short, practical instruction for a barber. 
          The instruction MUST be in 'Tanglish' (a mix of Telugu and English as commonly spoken by Telugu people). 
          Example: 'Sides lo zero fade chesi, top lo spikes ki saripada length unchandi'. 
          Keep it natural and easy to say to a barber.`,
        }));
        finalBarberTalk = talkResponse.text || "";
      } catch (talkErr: any) {
        const isQuotaError = talkErr.message?.includes("429") || talkErr.message?.includes("quota") || talkErr.message?.includes("RESOURCE_EXHAUSTED");
        if (!isQuotaError) {
          console.error("Failed to generate barber talk:", talkErr);
        }
        // Fallback to a generic one if it fails
        finalBarberTalk = "Sides lo trim chesi, top lo style ki thaggattu cut cheyandi.";
      }

      const now = new Date();
      const expires = new Date(now.getTime() + 60 * 60 * 1000);

      const path = 'generations';
      try {
        await addDoc(collection(db, path), {
          userId: user.uid,
          originalImageUrl: compressedOriginal,
          generatedImageUrl: compressedGenerated,
          prompt: pendingPrompt,
          barberTalk: finalBarberTalk,
          shirtRecommendation: faceAnalysis?.shirtRecommendation || "",
          pantRecommendation: faceAnalysis?.pantRecommendation || "",
          createdAt: now.toISOString(),
          expiresAt: expires.toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }

      setSimulationResult(compressedGenerated);
      setCurrentBarberTalk(finalBarberTalk);
      setCustomPrompt('');
      setSuggestions([]);
      setAnalysisResult(null);
    } catch (err: any) {
      const { message, isQuota, isAuth } = handleGenAIError(err);
      if (isAuth) {
        setError("API Key error. The current key is invalid or doesn't have access to this model.");
        setShowKeySelection(true);
      } else if (isQuota) {
        setError("AI service is currently busy (quota exceeded). You can try again in a few minutes, or select your own paid API key for higher limits.");
        setShowKeySelection(true);
      } else {
        setError(`Generation failed: ${message}`);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    const path = `generations/${id}`;
    try {
      await deleteDoc(doc(db, 'generations', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const downloadImage = (url: string, filename: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-stone-100 text-center"
        >
          <div className="w-16 h-16 bg-stone-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Scissors className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-stone-900 mb-2">Hair Style AI</h1>
          <p className="text-stone-500 mb-8">Try on new hairstyles with 100% face matching. Your photos are automatically deleted after 1 hour.</p>
          
          <button
            onClick={handleLogin}
            className="w-full py-4 bg-stone-900 text-white rounded-2xl font-semibold hover:bg-stone-800 transition-colors flex items-center justify-center gap-3"
          >
            <UserIcon className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans">
      <Toaster position="top-center" richColors />
      {/* Before/After Comparison Modal */}
      <AnimatePresence>
        {selectedComparison && (
          <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="relative w-full max-w-5xl aspect-[4/3] md:aspect-video bg-stone-900 rounded-[2.5rem] overflow-hidden shadow-2xl border border-white/10"
            >
              <BeforeAfterSlider 
                before={selectedComparison.originalImageUrl} 
                after={selectedComparison.generatedImageUrl} 
                className="w-full h-full"
              />
              
              <div className="absolute top-6 left-6 right-6 flex items-center justify-between pointer-events-none">
                <div className="flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-xs font-black text-white uppercase tracking-widest">Live Comparison</span>
                </div>
                <button 
                  onClick={() => setSelectedComparison(null)}
                  className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all pointer-events-auto active:scale-90"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-8 pointer-events-none">
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Original</span>
                  <div className="w-1 h-8 bg-white/20 rounded-full" />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Transformed</span>
                  <div className="w-1 h-8 bg-white/20 rounded-full" />
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="bg-white border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scissors className="w-6 h-6" />
            <span className="font-bold text-xl tracking-tight">Hair Style AI</span>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={async () => {
                await window.aistudio.openSelectKey();
                const hasKey = await window.aistudio.hasSelectedApiKey();
                setHasUserKey(hasKey);
                toast.success(hasKey ? "API Key updated!" : "API Key selection opened!");
              }}
              className="flex items-center gap-2 text-xs font-bold px-4 py-2 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
              title="Select your own API key for higher limits"
            >
              <Key className={cn("w-3 h-3", hasUserKey ? "text-emerald-400" : "text-stone-400")} />
              <span className="hidden xs:inline">API Settings</span>
            </button>
            <button 
              onClick={() => setShowCareTips(true)}
              className="text-sm font-semibold px-4 py-2 hover:bg-stone-100 rounded-full transition-colors flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Care Tips
            </button>
            <div className="hidden sm:flex items-center gap-2 text-sm text-stone-500">
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-stone-200" />
              <span>{user.displayName}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-stone-100 rounded-full text-stone-500 transition-colors"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Weather Tips Widget */}
        {weatherTips && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bg-gradient-to-r from-stone-900 to-stone-800 rounded-3xl p-6 text-white shadow-xl border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6"
          >
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-md">
                {weatherTips.condition === 'Sunny' ? <Sun className="w-8 h-8 text-amber-400" /> : <Cloud className="w-8 h-8 text-stone-300" />}
              </div>
              <div>
                <h3 className="text-lg font-bold flex items-center gap-2">
                  {weatherTips.condition} · {weatherTips.temp}°C
                  <span className="text-xs font-normal text-white/60">Humidity: {weatherTips.humidity}%</span>
                </h3>
                <p className="text-sm text-white/70">Weather-based hair care tips for today</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 justify-center md:justify-end">
              {weatherTips.tips.map((tip, idx) => (
                <div key={idx} className="px-4 py-2 bg-white/5 rounded-xl border border-white/10 text-xs font-medium backdrop-blur-sm">
                  {tip}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-2xl mb-8 overflow-x-auto no-scrollbar">
          {[
            { id: 'studio', label: 'Studio', icon: Scissors },
            { id: 'analysis', label: 'Analysis', icon: LayoutDashboard },
            { id: 'locator', label: 'Locator', icon: MapPin },
            { id: 'chat', label: 'Stylist Chat', icon: MessageSquare },
            { id: 'growth', label: 'Growth', icon: TrendingUp },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
                activeTab === tab.id 
                  ? "bg-white text-stone-900 shadow-sm" 
                  : "text-stone-500 hover:text-stone-700 hover:bg-white/50"
              )}
            >
              <tab.icon className={cn("w-4 h-4", activeTab === tab.id ? "text-emerald-600" : "text-stone-400")} />
              {tab.label}
            </button>
          ))}
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-600 text-sm mb-8"
          >
            <AlertCircle className="w-5 h-5 shrink-0" />
            <div className="flex-1 space-y-2">
              <p>{error}</p>
              <div className="flex flex-wrap gap-2">
                {showKeySelection && (
                  <button
                    onClick={async () => {
                      await window.aistudio.openSelectKey();
                      const hasKey = await window.aistudio.hasSelectedApiKey();
                      setHasUserKey(hasKey);
                      setShowKeySelection(false);
                      setError(null);
                    }}
                    className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-colors flex items-center gap-2"
                  >
                    <Key className="w-3 h-3 text-emerald-400" />
                    Select Your API Key
                  </button>
                )}
                {(activeTab === 'analysis' || activeTab === 'studio' || activeTab === 'chat') && (
                  <button
                    onClick={() => {
                      setError(null);
                      setShowKeySelection(false);
                      if (activeTab === 'analysis') handleSuggestStyles();
                      else if (activeTab === 'studio') handleGenerate();
                      else if (activeTab === 'chat') handleSendMessage();
                    }}
                    className="px-4 py-2 bg-white border border-red-200 text-red-600 rounded-xl text-xs font-bold hover:bg-red-50 transition-colors flex items-center gap-2"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'studio' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Upload & Controls */}
          <div className="lg:col-span-1 space-y-6">
            <section className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Upload Photo
              </h2>
              
              <div className="space-y-4">
                {selectedImage ? (
                  <div className="space-y-4">
                    <div className="relative aspect-square rounded-2xl overflow-hidden bg-stone-100 border border-stone-200 group">
                      <img src={selectedImage} alt="Preview" className="w-full h-full object-cover" />
                      <div className="absolute top-2 right-2 flex items-center gap-2">
                        <button 
                          onClick={() => downloadImage(selectedImage, `original-photo-${Date.now()}.png`)}
                          className="p-2 bg-white/90 backdrop-blur rounded-full shadow-lg hover:bg-white transition-colors text-stone-600"
                          title="Download Original"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => { 
                            setSelectedImage(null); 
                            setSuggestions([]); 
                            setMultiPhotos({});
                          }}
                          className="p-2 bg-white/90 backdrop-blur rounded-full shadow-lg hover:bg-white transition-colors text-red-500"
                          title="Remove Photo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* 360 Multi-Photo Display */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">360° Context (Optional)</label>
                        <button 
                          onClick={() => {
                            setIsMultiCapture(true);
                            setCurrentCaptureStep('front');
                            startCamera();
                          }}
                          className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 transition-colors flex items-center gap-1"
                        >
                          <Camera className="w-3 h-3" />
                          Start 360 Capture
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {['front', 'left', 'right', 'back'].map((angle) => (
                          <div key={angle} className="relative aspect-square rounded-lg overflow-hidden bg-stone-100 border border-stone-200 group">
                            {multiPhotos[angle as keyof typeof multiPhotos] ? (
                              <>
                                <img 
                                  src={multiPhotos[angle as keyof typeof multiPhotos]} 
                                  alt={angle} 
                                  className="w-full h-full object-cover" 
                                />
                                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] font-bold uppercase text-center py-0.5">
                                  {angle}
                                </div>
                                <div className="absolute top-0.5 right-0.5 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => {
                                      setIsMultiCapture(true);
                                      setCurrentCaptureStep(angle as any);
                                      startCamera();
                                    }}
                                    className="p-1 bg-white/80 rounded-full hover:bg-white shadow-sm"
                                    title="Retake"
                                  >
                                    <RefreshCw className="w-2 h-2 text-stone-600" />
                                  </button>
                                  <label className="p-1 bg-white/80 rounded-full hover:bg-white shadow-sm cursor-pointer" title="Upload">
                                    <Upload className="w-2 h-2 text-stone-600" />
                                    <input 
                                      type="file" 
                                      accept="image/*" 
                                      className="hidden" 
                                      onChange={(e) => handleMultiPhotoUpload(e, angle as any)} 
                                    />
                                  </label>
                                </div>
                              </>
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                                <div className="flex gap-1">
                                  <button 
                                    onClick={() => {
                                      setIsMultiCapture(true);
                                      setCurrentCaptureStep(angle as any);
                                      startCamera();
                                    }}
                                    className="p-1.5 bg-stone-200 rounded-full hover:bg-stone-300 transition-colors"
                                    title="Capture"
                                  >
                                    <Camera className="w-3 h-3 text-stone-600" />
                                  </button>
                                  <label className="p-1.5 bg-stone-200 rounded-full hover:bg-stone-300 transition-colors cursor-pointer" title="Upload">
                                    <Upload className="w-3 h-3 text-stone-600" />
                                    <input 
                                      type="file" 
                                      accept="image/*" 
                                      className="hidden" 
                                      onChange={(e) => handleMultiPhotoUpload(e, angle as any)} 
                                    />
                                  </label>
                                </div>
                                <span className="text-[8px] font-bold text-stone-400 uppercase">{angle}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    {!suggestions.length && !analyzing && (
                      <button 
                        onClick={handleSuggestStyles}
                        className="w-full py-3 text-sm font-bold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-all shadow-md flex items-center justify-center gap-2 group"
                      >
                        <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                        AI Smart Recommendation
                      </button>
                    )}

                    {analyzing && (
                      <div className="py-4 flex flex-col items-center justify-center gap-3 text-sm text-stone-500 bg-stone-50 rounded-2xl border border-stone-100 border-dashed">
                        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                        <span>Analyzing face shape & hairline...</span>
                      </div>
                    )}

                    {detectedPersons.length > 1 && (
                      <div className="space-y-3 p-4 bg-stone-50 rounded-2xl border border-stone-200">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Select Target Person</label>
                        <div className="flex flex-wrap gap-2">
                          {detectedPersons.map((p) => (
                            <button
                              key={p}
                              onClick={() => setTargetPerson(p)}
                              className={cn(
                                "px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all",
                                targetPerson === p 
                                  ? "bg-stone-900 border-stone-900 text-white shadow-sm" 
                                  : "bg-white border-stone-200 text-stone-500 hover:border-stone-400"
                              )}
                            >
                              {p}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {analysisResult && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span className="text-xs font-bold text-emerald-900 uppercase tracking-wider">AI Analysis</span>
                        </div>
                        <p className="text-xs text-emerald-800 leading-relaxed italic">"{analysisResult}"</p>
                      </motion.div>
                    )}

                    {suggestions.length > 0 && (
                      <div className="space-y-3">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Recommended for You</label>
                        <div className="flex flex-wrap gap-2">
                          {suggestions.map((s) => (
                            <div key={s} className="flex flex-col gap-1">
                              <button
                                onClick={() => setSelectedStyle(s)}
                                className={cn(
                                  "px-4 py-2 text-xs font-bold rounded-xl border transition-all text-left",
                                  selectedStyle === s 
                                    ? "bg-emerald-600 border-emerald-600 text-white shadow-lg scale-105" 
                                    : "bg-white border-stone-200 text-stone-600 hover:border-emerald-400 hover:text-emerald-600"
                                )}
                              >
                                {s}
                              </button>
                              {selectedStyle === s && barberTalkSuggestions[s] && (
                                <motion.div 
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  className="px-3 py-2 bg-stone-900 text-white rounded-lg text-[10px] font-medium mt-1 border border-stone-800 flex items-center justify-between gap-2"
                                >
                                  <div className="flex-1">
                                    <span className="text-emerald-400 font-bold">Barber Talk:</span> {barberTalkSuggestions[s]}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button 
                                      onClick={() => {
                                        const element = document.createElement("a");
                                        const file = new Blob([barberTalkSuggestions[s]], {type: 'text/plain'});
                                        element.href = URL.createObjectURL(file);
                                        element.download = `barber-instructions-${s.toLowerCase().replace(/\s+/g, '-')}.txt`;
                                        document.body.appendChild(element);
                                        element.click();
                                      }}
                                      className="p-1 hover:bg-white/10 rounded transition-colors"
                                      title="Download Instructions (TXT)"
                                    >
                                      <FileText className="w-3 h-3 text-white/40" />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        navigator.clipboard.writeText(barberTalkSuggestions[s]);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                      }}
                                      className="p-1 hover:bg-white/10 rounded transition-colors"
                                      title="Copy Instructions"
                                    >
                                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    </button>
                                  </div>
                                </motion.div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    <button 
                      onClick={() => startCamera()}
                      className="aspect-square flex flex-col items-center justify-center gap-2 border-2 border-dashed border-stone-200 rounded-2xl hover:border-stone-400 hover:bg-stone-50 transition-all group"
                    >
                      <Camera className="w-8 h-8 text-stone-400 group-hover:text-stone-600" />
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Camera</span>
                    </button>
                    <button 
                      onClick={() => {
                        setIsMultiCapture(true);
                        setCurrentCaptureStep('front');
                        startCamera();
                      }}
                      className="aspect-square flex flex-col items-center justify-center gap-2 border-2 border-dashed border-emerald-200 bg-emerald-50/30 rounded-2xl hover:border-emerald-400 hover:bg-emerald-50 transition-all group"
                    >
                      <RefreshCw className="w-8 h-8 text-emerald-400 group-hover:text-emerald-600" />
                      <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">360° Capture</span>
                    </button>
                    <label className="aspect-square flex flex-col items-center justify-center gap-2 border-2 border-dashed border-stone-200 rounded-2xl hover:border-stone-400 hover:bg-stone-50 cursor-pointer transition-all group">
                      <Upload className="w-8 h-8 text-stone-400 group-hover:text-stone-600" />
                      <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider">Upload</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    </label>
                  </div>
                )}

                {/* Saved Presets */}
                {savedPreferences.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Your Presets</label>
                    <div className="flex flex-wrap gap-2">
                      {savedPreferences.map((pref) => (
                        <div key={pref.id} className="group relative">
                          <button
                            onClick={() => handleLoadPreference(pref)}
                            className={cn(
                              "py-2 px-3 text-[10px] font-bold rounded-xl border transition-all flex items-center gap-2",
                              selectedStyle === pref.styleName && customPrompt === pref.customPrompt
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm"
                                : "bg-white border-stone-200 text-stone-600 hover:border-stone-400"
                            )}
                          >
                            <Bookmark className="w-3 h-3" />
                            {pref.name}
                          </button>
                          <button 
                            onClick={() => handleDeletePreference(pref.id)}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                          >
                            <X className="w-2 h-2" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Simulation Modes */}
                {selectedImage && (
                  <div className="space-y-4 pt-4 border-t border-stone-100">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Simulation Modes</label>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => { setIsVirtualTryOn(!isVirtualTryOn); setIsColorSimulation(false); }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1.5",
                            isVirtualTryOn ? "bg-indigo-600 border-indigo-600 text-white shadow-md" : "bg-white border-stone-200 text-stone-500 hover:border-indigo-400"
                          )}
                        >
                          <Sparkles className="w-3 h-3" />
                          Virtual Try-On
                        </button>
                        <button 
                          onClick={() => { setIsColorSimulation(!isColorSimulation); setIsVirtualTryOn(false); }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1.5",
                            isColorSimulation ? "bg-rose-600 border-rose-600 text-white shadow-md" : "bg-white border-stone-200 text-stone-500 hover:border-rose-400"
                          )}
                        >
                          <Palette className="w-3 h-3" />
                          Color Simulation
                        </button>
                        <button 
                          onClick={() => { setIs360Mode(!is360Mode); }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1.5",
                            is360Mode ? "bg-emerald-600 border-emerald-600 text-white shadow-md" : "bg-white border-stone-200 text-stone-500 hover:border-emerald-400"
                          )}
                        >
                          <RefreshCw className="w-3 h-3" />
                          360° Perspective
                        </button>
                        <button 
                          onClick={() => { setIsAvatarMode(!isAvatarMode); }}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center gap-1.5",
                            isAvatarMode ? "bg-purple-600 border-purple-600 text-white shadow-md" : "bg-white border-stone-200 text-stone-500 hover:border-purple-400"
                          )}
                        >
                          <UserIcon className="w-3 h-3" />
                          Avatar Mode
                        </button>
                      </div>
                    </div>

                    {isVirtualTryOn && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-3 p-4 bg-indigo-50 rounded-2xl border border-indigo-100"
                      >
                        <p className="text-[10px] text-indigo-700 font-medium">Try on a specific style on your face using AI simulation.</p>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                          {['Buzz Cut', 'Pompadour', 'Fade', 'Long Waves', 'Man Bun'].map(s => (
                            <button
                              key={s}
                              onClick={() => setSimulationStyle(s)}
                              className={cn(
                                "px-3 py-1.5 rounded-lg text-[10px] font-bold border whitespace-nowrap transition-all",
                                simulationStyle === s ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-indigo-200 text-indigo-600 hover:bg-indigo-100"
                              )}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        <button 
                          onClick={handleSimulate}
                          disabled={isSimulating || !simulationStyle}
                          className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isSimulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                          Run Virtual Try-On
                        </button>
                      </motion.div>
                    )}

                    {isColorSimulation && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="space-y-3 p-4 bg-rose-50 rounded-2xl border border-rose-100"
                      >
                        <p className="text-[10px] text-rose-700 font-medium">See how different hair colors look on you.</p>
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                          {[
                            { name: 'Black', color: '#000000' },
                            { name: 'Brown', color: '#4a2c2a' },
                            { name: 'Blonde', color: '#e3c58d' },
                            { name: 'Silver', color: '#c0c0c0' },
                            { name: 'Blue', color: '#1e40af' },
                          ].map(c => (
                            <button
                              key={c.name}
                              onClick={() => setSimulationColor(c.color)}
                              className={cn(
                                "w-8 h-8 rounded-full border-2 transition-all flex-shrink-0",
                                simulationColor === c.color ? "border-rose-600 scale-110 shadow-md" : "border-white hover:scale-105"
                              )}
                              style={{ backgroundColor: c.color }}
                              title={c.name}
                            />
                          ))}
                        </div>
                        <button 
                          onClick={handleSimulate}
                          disabled={isSimulating}
                          className="w-full py-2.5 bg-rose-600 text-white rounded-xl text-xs font-bold hover:bg-rose-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isSimulating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Palette className="w-4 h-4" />}
                          Run Color Simulation
                        </button>
                      </motion.div>
                    )}

                    {simulationResult && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative aspect-square rounded-2xl overflow-hidden bg-stone-900 border border-stone-800 shadow-2xl"
                      >
                        {isResult360 ? (
                          <RotationPreview 
                            imageUrl={simulationResult} 
                            className="w-full h-full"
                          />
                        ) : (
                          <BeforeAfterSlider 
                            before={selectedImage!} 
                            after={simulationResult} 
                            className="w-full h-full"
                          />
                        )}
                        <div className="absolute top-3 right-3 flex items-center gap-2">
                          <button 
                            onClick={() => downloadImage(simulationResult, `hairstyle-ai-${Date.now()}.png`)}
                            className="p-2 bg-emerald-500 hover:bg-emerald-600 backdrop-blur-md rounded-full text-white transition-all shadow-lg"
                            title="Download Result"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              setSimulationResult(null);
                              setCurrentBarberTalk(null);
                            }}
                            className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </motion.div>
                    )}

                    {simulationResult && currentBarberTalk && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="p-4 bg-stone-900 rounded-2xl border border-stone-800 shadow-xl"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-emerald-400">How to tell your Barber</h4>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => {
                                const element = document.createElement("a");
                                const file = new Blob([currentBarberTalk], {type: 'text/plain'});
                                element.href = URL.createObjectURL(file);
                                element.download = `barber-instructions-${Date.now()}.txt`;
                                document.body.appendChild(element);
                                element.click();
                              }}
                              className="p-1 hover:bg-white/10 rounded transition-colors"
                              title="Download Instructions (TXT)"
                            >
                              <FileText className="w-3 h-3 text-white/40" />
                            </button>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(currentBarberTalk);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                              }}
                              className="p-1 hover:bg-white/10 rounded transition-colors"
                              title="Copy Instructions"
                            >
                              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-white/40" />}
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-stone-300 font-medium leading-relaxed italic">
                          "{currentBarberTalk}"
                        </p>
                      </motion.div>
                    )}
                  </div>
                )}

                {/* Model Reference Photo */}
                <div className="space-y-4 pt-4 border-t border-stone-100">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Model Reference Photo (Optional)</label>
                    {referenceImage && (
                      <button 
                        onClick={() => setReferenceImage(null)}
                        className="text-[10px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        Clear Reference
                      </button>
                    )}
                  </div>
                  
                  {referenceImage ? (
                    <div className="relative aspect-video rounded-2xl overflow-hidden bg-stone-100 border border-stone-200 group">
                      <img src={referenceImage} alt="Reference" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <label className="p-3 bg-white rounded-full cursor-pointer hover:scale-110 transition-transform shadow-lg">
                          <RefreshCw className="w-5 h-5 text-stone-600" />
                          <input type="file" accept="image/*" className="hidden" onChange={handleReferenceFileChange} />
                        </label>
                      </div>
                      <div className="absolute top-2 right-2 flex gap-2">
                        <button 
                          onClick={() => setReferenceImage(null)}
                          className="p-1.5 bg-white/90 hover:bg-white rounded-full text-rose-500 shadow-lg transition-colors"
                          title="Remove Reference"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="absolute top-2 left-2 px-2 py-0.5 bg-emerald-500 text-white text-[8px] font-black uppercase tracking-widest rounded-full">
                        Hairstyle Source
                      </div>
                    </div>
                  ) : (
                    <label className="flex items-center gap-4 p-4 bg-stone-50 border-2 border-dashed border-stone-200 rounded-2xl hover:border-emerald-400 hover:bg-emerald-50/30 cursor-pointer transition-all group">
                      <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                        <Upload className="w-5 h-5 text-stone-400 group-hover:text-emerald-500" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-stone-700">Upload a Model Photo</p>
                        <p className="text-[10px] text-stone-400">We'll copy the {selectedFeatures.join(' & ')} from this photo</p>
                      </div>
                      <input type="file" accept="image/*" className="hidden" onChange={handleReferenceFileChange} />
                    </label>
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t border-stone-100">
                  <label className="text-xs font-bold uppercase tracking-wider text-stone-400">What to Transform?</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'hair', label: 'Hair', icon: <Scissors className="w-3 h-3" /> },
                      { id: 'beard', label: 'Beard', icon: <UserIcon className="w-3 h-3" /> },
                      { id: 'moustache', label: 'Moustache', icon: <UserIcon className="w-3 h-3" /> }
                    ].map(feature => (
                      <button
                        key={feature.id}
                        onClick={() => {
                          setSelectedFeatures(prev => 
                            prev.includes(feature.id) 
                              ? (prev.length > 1 ? prev.filter(f => f !== feature.id) : prev)
                              : [...prev, feature.id]
                          );
                        }}
                        className={cn(
                          "px-4 py-2 rounded-xl text-[10px] font-bold border transition-all flex items-center gap-2",
                          selectedFeatures.includes(feature.id)
                            ? "bg-stone-900 border-stone-900 text-white shadow-md"
                            : "bg-white border-stone-200 text-stone-500 hover:border-stone-400"
                        )}
                      >
                        {feature.icon}
                        {feature.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Select Style</label>
                    <select 
                      value={selectedCountry}
                      onChange={(e) => setSelectedCountry(e.target.value)}
                      className="text-[10px] font-bold uppercase tracking-wider bg-stone-100 text-stone-600 px-2 py-1 rounded-lg outline-none cursor-pointer hover:bg-stone-200 transition-colors"
                    >
                      <option value="Global">All Regions</option>
                      <option value="India">India</option>
                      <option value="USA">USA</option>
                      <option value="Korea">Korea</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {filteredStyles.map((style) => (
                      <button
                        key={style.name}
                        onClick={() => setSelectedStyle(style.name)}
                        className={cn(
                          "py-2 px-3 text-xs font-medium rounded-xl border transition-all",
                          selectedStyle === style.name 
                            ? "bg-stone-900 border-stone-900 text-white shadow-md" 
                            : "bg-white border-stone-200 text-stone-600 hover:border-stone-400"
                        )}
                      >
                        {style.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Custom Details (Optional)</label>
                    {user && (
                      <button 
                        onClick={() => setShowSaveModal(true)}
                        className="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1 transition-colors"
                      >
                        <Save className="w-3 h-3" />
                        Save as Preset
                      </button>
                    )}
                  </div>
                  <textarea 
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="e.g. make it blonde, add a beard..."
                    className="w-full p-3 text-sm rounded-xl border border-stone-200 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none resize-none h-20"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleGenerate}
                    disabled={!selectedImage || uploading}
                    className={cn(
                      "flex-1 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg",
                      !selectedImage || uploading
                        ? "bg-stone-100 text-stone-400 cursor-not-allowed"
                        : "bg-stone-900 text-white hover:bg-stone-800 active:scale-[0.98]"
                    )}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        {is360Mode ? "Generating 360° Collage..." : (referenceImage ? `Copying ${selectedFeatures.join(' & ')}...` : "Generating...")}
                      </>
                    ) : (
                      <>
                        {is360Mode ? <RefreshCw className="w-5 h-5" /> : <Scissors className="w-5 h-5" />}
                        {isAvatarMode ? (is360Mode ? "Generate 360° Avatar" : "Create My Avatar") : (is360Mode ? "Generate 360° View" : (referenceImage ? `Apply Model's ${selectedFeatures.join(' & ')}` : `Transform My ${selectedFeatures.join(' & ')}`))}
                      </>
                    )}
                  </button>
                  
                  {!is360Mode && (
                    <button 
                      onClick={() => { setIs360Mode(true); setTimeout(handleGenerate, 100); }}
                      disabled={!selectedImage || uploading}
                      className={cn(
                        "px-6 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all border",
                        !selectedImage || uploading
                          ? "bg-stone-50 border-stone-100 text-stone-300 cursor-not-allowed"
                          : "bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100"
                      )}
                      title="Generate 4-view collage"
                    >
                      <RefreshCw className="w-5 h-5" />
                      360°
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* Save Preset Modal */}
          <AnimatePresence>
            {showSaveModal && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                <motion.div 
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-stone-900">Save Preset</h3>
                    <button onClick={() => setShowSaveModal(false)} className="text-stone-400 hover:text-stone-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-stone-400">Preset Name</label>
                    <input 
                      type="text"
                      value={preferenceName}
                      onChange={(e) => setPreferenceName(e.target.value)}
                      placeholder="e.g. My Summer Look"
                      className="w-full p-3 text-sm rounded-xl border border-stone-200 focus:ring-2 focus:ring-stone-900 focus:border-transparent outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="p-3 bg-stone-50 rounded-xl space-y-1">
                    <p className="text-[10px] uppercase font-bold text-stone-400">Current Settings</p>
                    <p className="text-xs font-medium text-stone-600"><span className="text-stone-400">Style:</span> {selectedStyle}</p>
                    {customPrompt && <p className="text-xs font-medium text-stone-600 truncate"><span className="text-stone-400">Details:</span> {customPrompt}</p>}
                  </div>
                  <button
                    onClick={handleSavePreference}
                    disabled={savingPreference || !preferenceName.trim()}
                    className="w-full py-3 bg-stone-900 text-white rounded-xl font-bold hover:bg-stone-800 disabled:bg-stone-100 disabled:text-stone-400 transition-all flex items-center justify-center gap-2"
                  >
                    {savingPreference ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Preset
                  </button>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Right Column: History */}
          <div className="lg:col-span-2 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">Your Transformations</h2>
              <div className="flex items-center gap-2 text-xs font-medium text-stone-400 bg-stone-100 px-3 py-1.5 rounded-full">
                <Clock className="w-3.5 h-3.5" />
                Auto-deletes in 1 hour
              </div>
            </div>

            {generations.length === 0 ? (
              <div className="bg-white border border-stone-200 border-dashed rounded-3xl p-12 text-center">
                <div className="w-12 h-12 bg-stone-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Scissors className="text-stone-300 w-6 h-6" />
                </div>
                <p className="text-stone-500">No transformations yet. Upload a photo to get started!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <AnimatePresence mode="popLayout">
                  {generations.map((gen) => (
                    <motion.div
                      key={gen.id}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="bg-white rounded-3xl border border-stone-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow group"
                    >
                      <div className="relative aspect-square">
                        <img 
                          src={gen.generatedImageUrl} 
                          alt="Generated hairstyle" 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <button 
                            onClick={() => setSelectedComparison(gen)}
                            className="p-3 bg-white rounded-full hover:scale-110 transition-transform shadow-xl"
                            title="Compare Side-by-Side"
                          >
                            <RefreshCw className="w-5 h-5 text-emerald-600" />
                          </button>
                          <button 
                            onClick={() => downloadImage(gen.generatedImageUrl, `hairstyle-${gen.id}.png`)}
                            className="p-3 bg-white rounded-full hover:scale-110 transition-transform shadow-xl"
                            title="Download"
                          >
                            <Download className="w-5 h-5 text-stone-900" />
                          </button>
                          <button 
                            onClick={() => handleDelete(gen.id)}
                            className="p-3 bg-white rounded-full hover:scale-110 transition-transform shadow-xl"
                            title="Delete Now"
                          >
                            <Trash2 className="w-5 h-5 text-red-500" />
                          </button>
                        </div>
                      </div>
                      <div className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span className="text-xs font-medium text-stone-600">Perfect Match</span>
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-stone-400 font-bold">
                          {new Date(gen.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {gen.barberTalk && (
                        <div className="px-4 pb-4">
                          <div className="p-3 bg-stone-900 rounded-2xl border border-stone-800 shadow-inner">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">How to tell Barber</span>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={() => downloadImage(gen.generatedImageUrl, `hairstyle-${gen.id}.png`)}
                                  className="text-white/40 hover:text-white transition-colors"
                                  title="Download Image"
                                >
                                  <Download className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={() => {
                                    const element = document.createElement("a");
                                    const file = new Blob([gen.barberTalk || ''], {type: 'text/plain'});
                                    element.href = URL.createObjectURL(file);
                                    element.download = `barber-instructions-${gen.id}.txt`;
                                    document.body.appendChild(element);
                                    element.click();
                                  }}
                                  className="text-white/40 hover:text-white transition-colors"
                                  title="Download Instructions (TXT)"
                                >
                                  <FileText className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={() => {
                                    navigator.clipboard.writeText(gen.barberTalk || '');
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 2000);
                                  }}
                                  className="text-white/40 hover:text-white transition-colors"
                                >
                                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-stone-300 font-medium leading-relaxed">
                              {gen.barberTalk}
                            </p>
                          </div>
                        </div>
                      )}

                      {(gen.shirtRecommendation || gen.pantRecommendation) && (
                        <div className="px-4 pb-4">
                          <div className="p-3 bg-stone-50 rounded-2xl border border-stone-100">
                            <p className="text-[10px] font-black uppercase tracking-widest text-stone-400 mb-2">Outfit Recommendations</p>
                            <div className="grid grid-cols-2 gap-2">
                              {gen.shirtRecommendation && (
                                <div className="space-y-0.5">
                                  <p className="text-[8px] font-black uppercase tracking-widest text-stone-400">Shirt</p>
                                  <p className="text-[10px] font-medium text-stone-800 leading-tight">{gen.shirtRecommendation}</p>
                                </div>
                              )}
                              {gen.pantRecommendation && (
                                <div className="space-y-0.5">
                                  <p className="text-[8px] font-black uppercase tracking-widest text-stone-400">Pant</p>
                                  <p className="text-[10px] font-medium text-stone-800 leading-tight">{gen.pantRecommendation}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-1 space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <LayoutDashboard className="w-5 h-5 text-emerald-600" />
                    Face Analysis
                  </h3>
                  {faceAnalysis ? (
                    <div className="space-y-6">
                      <div className="p-4 bg-stone-900 rounded-2xl text-white text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-1">Detected Shape</p>
                        <p className="text-2xl font-black tracking-tight capitalize">{faceAnalysis.shape}</p>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Characteristics</p>
                          <div className="flex flex-wrap gap-2">
                            {faceAnalysis.characteristics.map((c, i) => (
                              <span key={i} className="px-3 py-1 bg-stone-100 text-stone-600 rounded-lg text-[10px] font-bold border border-stone-200">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Best Styles</p>
                          <div className="space-y-2">
                            {faceAnalysis.bestStyles.map((s, i) => (
                              <div key={i} className="p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-xs font-medium text-emerald-800">
                                {s}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-bold text-stone-400 uppercase tracking-wider">Outfit Recommendations</p>
                          <div className="space-y-3">
                            {faceAnalysis.shirtRecommendation && (
                              <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-stone-400 mb-1">Shirt</p>
                                <p className="text-xs font-medium text-stone-800">{faceAnalysis.shirtRecommendation}</p>
                              </div>
                            )}
                            {faceAnalysis.pantRecommendation && (
                              <div className="p-3 bg-stone-50 border border-stone-100 rounded-xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-stone-400 mb-1">Pant</p>
                                <p className="text-xs font-medium text-stone-800">{faceAnalysis.pantRecommendation}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-12 space-y-4">
                      <div className="w-12 h-12 bg-stone-50 rounded-2xl flex items-center justify-center mx-auto">
                        <Info className="w-6 h-6 text-stone-300" />
                      </div>
                      <p className="text-sm text-stone-500">Upload a photo in the Studio tab and run "AI Smart Recommendation" to see your analysis here.</p>
                    </div>
                  )}
                </div>

                {products.length > 0 && (
                  <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                      <ShoppingBag className="w-5 h-5 text-indigo-600" />
                      Recommended Products
                    </h3>
                    <div className="space-y-4">
                      {products.map((product, i) => (
                        <div key={i} className="p-4 bg-stone-50 rounded-2xl border border-stone-100 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black text-stone-900">{product.name}</span>
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded text-[10px] font-bold uppercase">{product.category}</span>
                          </div>
                          <p className="text-[11px] text-stone-500 leading-relaxed">{product.reason}</p>
                          <a 
                            href={`https://www.google.com/search?q=${encodeURIComponent(product.name)}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                          >
                            Find Online <ChevronRight className="w-3 h-3" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="md:col-span-2 space-y-6">
                {/* Recommended Style Previews */}
                {(generatingRecommendations || recommendedImages.length > 0) && (
                  <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
                        <Sparkles className="w-6 h-6 text-emerald-500" />
                        Recommended Style Previews
                      </h3>
                      {generatingRecommendations && (
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 animate-pulse">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Generating Previews...
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      {generatingRecommendations && recommendedImages.length === 0 ? (
                        [1, 2, 3].map((i) => (
                          <div key={i} className="aspect-square bg-stone-50 rounded-3xl border border-stone-100 animate-pulse flex flex-col items-center justify-center gap-3">
                            <div className="w-12 h-12 bg-stone-100 rounded-2xl" />
                            <div className="h-2 w-24 bg-stone-100 rounded-full" />
                          </div>
                        ))
                      ) : (
                        recommendedImages.map((img, i) => (
                          <motion.div 
                            key={i}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.1 }}
                            className="group relative"
                          >
                            <div className="aspect-square rounded-3xl overflow-hidden border border-stone-200 shadow-sm group-hover:shadow-xl transition-all duration-500">
                              <BeforeAfterSlider 
                                before={selectedImage!} 
                                after={img.url} 
                                className="w-full h-full"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-4 gap-2">
                                <div className="flex items-center justify-between">
                                  <p className="text-white text-[10px] font-black uppercase tracking-widest">{img.style}</p>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      downloadImage(img.url, `style-${img.style.toLowerCase().replace(/\s+/g, '-')}.png`);
                                    }}
                                    className="p-1.5 bg-white/20 hover:bg-white/40 rounded-lg text-white transition-colors"
                                    title="Download"
                                  >
                                    <Download className="w-3 h-3" />
                                  </button>
                                </div>
                                <div className="flex gap-2">
                                  <button 
                                    onClick={() => {
                                      setSimulationResult(img.url);
                                      setSelectedStyle(img.style);
                                      setActiveTab('studio');
                                    }}
                                    className="flex-1 py-2 bg-white text-stone-900 rounded-xl text-[10px] font-bold hover:bg-emerald-400 hover:text-white transition-colors"
                                  >
                                    Select Style
                                  </button>
                                  <button 
                                    onClick={() => {
                                      setSelectedStyle(img.style);
                                      setIs360Mode(true);
                                      setActiveTab('studio');
                                      setTimeout(handleGenerate, 100);
                                    }}
                                    className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
                                    title="Generate 360° View"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 text-center">
                              <p className="text-[11px] font-bold text-stone-900 truncate">{img.style}</p>
                            </div>
                          </motion.div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-white p-8 rounded-[2.5rem] border border-stone-200 shadow-sm min-h-[400px]">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-black tracking-tight flex items-center gap-3">
                      <Activity className="w-6 h-6 text-rose-500" />
                      Scalp Health Analysis
                    </h3>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => startCamera()}
                        className="p-3 bg-stone-100 text-stone-600 rounded-2xl hover:bg-stone-200 transition-all"
                        title="Take Scalp Photo"
                      >
                        <Camera className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={handleAnalyzeScalp}
                        disabled={!selectedImage || analyzingScalp}
                        className="px-6 py-3 bg-rose-600 text-white rounded-2xl text-sm font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20 disabled:opacity-50 flex items-center gap-2"
                      >
                        {analyzingScalp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        Analyze Scalp
                      </button>
                    </div>
                  </div>

                  {scalpAnalysis ? (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="grid grid-cols-1 lg:grid-cols-2 gap-8"
                    >
                      <div className="space-y-6">
                        <div className="relative w-32 h-32 mx-auto">
                          <svg className="w-full h-full transform -rotate-90">
                            <circle
                              cx="64"
                              cy="64"
                              r="58"
                              stroke="currentColor"
                              strokeWidth="8"
                              fill="transparent"
                              className="text-stone-100"
                            />
                            <circle
                              cx="64"
                              cy="64"
                              r="58"
                              stroke="currentColor"
                              strokeWidth="8"
                              fill="transparent"
                              strokeDasharray={364.4}
                              strokeDashoffset={364.4 - (364.4 * scalpAnalysis.healthScore) / 100}
                              className="text-rose-500 transition-all duration-1000 ease-out"
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-black text-stone-900">{scalpAnalysis.healthScore}</span>
                            <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Score</span>
                          </div>
                        </div>

                        <div className="p-6 bg-rose-50 rounded-3xl border border-rose-100">
                          <h4 className="text-sm font-bold text-rose-900 mb-2 flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            AI Observations
                          </h4>
                          <p className="text-xs text-rose-800 leading-relaxed italic">"{scalpAnalysis.analysis}"</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        <div className="space-y-3">
                          <h4 className="text-xs font-black text-stone-400 uppercase tracking-widest">Potential Concerns</h4>
                          <div className="flex flex-wrap gap-2">
                            {scalpAnalysis.concerns.map((c, i) => (
                              <span key={i} className="px-3 py-1.5 bg-white border border-rose-100 text-rose-600 rounded-xl text-[10px] font-bold shadow-sm">
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-3">
                          <h4 className="text-xs font-black text-stone-400 uppercase tracking-widest">Recommended Actions</h4>
                          <div className="space-y-2">
                            {scalpAnalysis.recommendations.map((r, i) => (
                              <div key={i} className="flex items-start gap-3 p-3 bg-white border border-stone-100 rounded-2xl shadow-sm">
                                <div className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                  <Check className="w-3 h-3 text-emerald-600" />
                                </div>
                                <span className="text-xs text-stone-600 font-medium leading-relaxed">{r}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-4 opacity-40">
                      <div className="w-20 h-20 bg-stone-100 rounded-3xl flex items-center justify-center">
                        <Activity className="w-10 h-10 text-stone-400" />
                      </div>
                      <p className="text-sm font-medium text-stone-500 max-w-xs">
                        Upload a close-up photo of your scalp to get a detailed health analysis and personalized care plan.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'locator' && (
          <div className="bg-white rounded-[2.5rem] border border-stone-200 shadow-sm overflow-hidden h-[700px]">
            <BarberLocator onBook={handleBookAppointment} />
          </div>
        )}

        {activeTab === 'chat' && (
          <div className="max-w-3xl mx-auto h-[700px] flex flex-col bg-white rounded-[2.5rem] border border-stone-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-stone-100 bg-stone-900 text-white flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                <MessageSquare className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black tracking-tight">AI Hair Stylist</h2>
                <p className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest">Always Online • Expert Advice</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-stone-50/50">
              {chatMessages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-40">
                  <div className="w-16 h-16 bg-stone-200 rounded-full flex items-center justify-center">
                    <MessageSquare className="w-8 h-8 text-stone-400" />
                  </div>
                  <p className="text-sm font-medium text-stone-500">Ask me anything about hair care, styles, or trends!</p>
                </div>
              ) : (
                chatMessages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn(
                      "flex",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}
                  >
                    <div className={cn(
                      "max-w-[80%] p-4 rounded-2xl text-sm shadow-sm",
                      msg.role === 'user' 
                        ? "bg-stone-900 text-white rounded-tr-none" 
                        : "bg-white border border-stone-200 text-stone-800 rounded-tl-none"
                    )}>
                      {msg.text}
                    </div>
                  </motion.div>
                ))
              )}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-stone-200 p-4 rounded-2xl rounded-tl-none shadow-sm">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-white border-t border-stone-100">
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="flex gap-3"
              >
                <input 
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask your stylist..."
                  className="flex-1 px-6 py-4 bg-stone-100 rounded-2xl border-none focus:ring-2 focus:ring-stone-900 outline-none text-sm font-medium"
                />
                <button 
                  type="submit"
                  disabled={!chatInput.trim() || isChatLoading}
                  className="p-4 bg-stone-900 text-white rounded-2xl hover:bg-stone-800 transition-all disabled:opacity-50 active:scale-95 shadow-lg"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'growth' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="md:col-span-1 space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm">
                  <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    Log Progress
                  </h3>
                  <div className="space-y-4">
                    <label className="block aspect-video border-2 border-dashed border-stone-200 rounded-2xl hover:border-stone-400 hover:bg-stone-50 transition-all cursor-pointer group relative overflow-hidden">
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                        <Camera className="w-8 h-8 text-stone-400 group-hover:text-stone-600" />
                        <span className="text-xs font-bold text-stone-500">Take/Upload Photo</span>
                      </div>
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleGrowthUpload(file);
                        }}
                        disabled={isUploadingGrowth}
                      />
                      {isUploadingGrowth && (
                        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                          <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                        </div>
                      )}
                    </label>
                    <p className="text-[10px] text-stone-400 text-center font-medium">Track your hair or beard growth journey day by day.</p>
                  </div>
                </div>

                <div className="bg-stone-900 p-6 rounded-3xl text-white space-y-4 shadow-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
                      <History className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h4 className="font-bold">Growth Stats</h4>
                      <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest">Your Journey</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-[10px] text-white/40 uppercase font-black mb-1">Total Logs</p>
                      <p className="text-2xl font-black">{growthLogs.length}</p>
                    </div>
                    <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                      <p className="text-[10px] text-white/40 uppercase font-black mb-1">Days Tracked</p>
                      <p className="text-2xl font-black">
                        {growthLogs.length > 1 
                          ? Math.ceil((new Date(growthLogs[0].createdAt).getTime() - new Date(growthLogs[growthLogs.length-1].createdAt).getTime()) / (1000 * 60 * 60 * 24))
                          : growthLogs.length}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 space-y-6">
                <h3 className="text-2xl font-black tracking-tight flex items-center gap-3">
                  Timeline
                  <span className="px-3 py-1 bg-stone-100 text-stone-500 rounded-full text-xs font-bold">{growthLogs.length} Entries</span>
                </h3>
                
                {growthLogs.length === 0 ? (
                  <div className="bg-white border border-stone-200 border-dashed rounded-[2.5rem] p-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto">
                      <Calendar className="w-8 h-8 text-stone-300" />
                    </div>
                    <p className="text-stone-500 font-medium">Your growth timeline is empty. Start by logging your first photo!</p>
                  </div>
                ) : (
                  <div className="space-y-8 relative before:absolute before:left-6 before:top-0 before:bottom-0 before:w-0.5 before:bg-stone-100">
                    {growthLogs.map((log) => (
                      <div key={log.id} className="relative pl-16">
                        <div className="absolute left-4 top-0 w-4 h-4 rounded-full bg-white border-4 border-emerald-500 z-10" />
                        <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow group">
                          <div className="flex flex-col md:flex-row gap-6">
                            <div className="w-full md:w-48 aspect-square rounded-2xl overflow-hidden bg-stone-100 shrink-0">
                              <img src={log.imageUrl} alt="Growth log" className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 space-y-4">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-lg font-black text-stone-900">
                                    {new Date(log.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                                  </p>
                                  <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                                    {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                                <button 
                                  onClick={() => handleDeleteGrowthLog(log.id)}
                                  className="p-2 text-stone-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-5 h-5" />
                                </button>
                              </div>
                              <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                                <p className="text-sm text-stone-600 leading-relaxed italic">
                                  {log.notes || "No notes added for this entry."}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Booking Modal */}
      <AnimatePresence>
        {isBookingModalOpen && selectedBarberForBooking && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-[2.5rem] overflow-hidden max-w-md w-full shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-stone-100 bg-stone-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center">
                    <Calendar className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg tracking-tight">Book Appointment</h3>
                    <p className="text-indigo-300 text-[10px] font-bold uppercase tracking-widest">{selectedBarberForBooking.displayName}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsBookingModalOpen(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <Trash2 className="w-5 h-5 text-white/60" />
                </button>
              </div>
              
              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                    <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Location</p>
                    <p className="text-sm text-stone-900 font-medium">{selectedBarberForBooking.formattedAddress}</p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                      <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Date</p>
                      <input type="date" className="bg-transparent text-sm font-bold text-stone-900 w-full outline-none" defaultValue={new Date().toISOString().split('T')[0]} />
                    </div>
                    <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100">
                      <p className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-1">Time</p>
                      <input type="time" className="bg-transparent text-sm font-bold text-stone-900 w-full outline-none" defaultValue="10:00" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <Check className="w-5 h-5 text-emerald-500 shrink-0" />
                  <p className="text-[10px] text-emerald-700 leading-tight font-bold">
                    This barber is currently open and accepting bookings.
                  </p>
                </div>
              </div>
              
              <div className="p-6 border-t border-stone-100 bg-stone-50 flex gap-3">
                <button 
                  onClick={() => setIsBookingModalOpen(false)}
                  className="flex-1 py-4 text-sm font-bold text-stone-600 hover:bg-stone-200 rounded-2xl transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setIsBookingModalOpen(false);
                    // In a real app, this would save to a 'bookings' collection
                    alert("Appointment booked successfully! You will receive a confirmation message soon.");
                  }}
                  className="flex-[2] py-4 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2"
                >
                  Confirm Booking
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Prompt Preview Modal */}
      <AnimatePresence>
        {showPromptPreview && pendingPrompt && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-[2.5rem] overflow-hidden max-w-lg w-full max-h-[90vh] shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-stone-100 bg-stone-900 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-500 rounded-xl flex items-center justify-center">
                    <Scissors className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-black text-lg tracking-tight">Review Prompt</h3>
                    <p className="text-indigo-300 text-[10px] font-bold uppercase tracking-widest">Final Instructions</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowPromptPreview(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <Trash2 className="w-5 h-5 text-white/60" />
                </button>
              </div>
              
              <div className="p-8 space-y-6 overflow-y-auto flex-1">
                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative p-6 bg-white rounded-2xl border border-stone-100 shadow-inner">
                    <p className="text-sm text-stone-600 leading-relaxed font-medium italic">
                      {pendingPrompt}
                    </p>
                  </div>
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <button 
                      onClick={handleCopyPrompt}
                      className="p-2 bg-stone-900 text-white rounded-lg shadow-lg hover:scale-110 transition-all active:scale-95"
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-[11px] text-emerald-700 leading-tight font-bold">
                      AI Generation Ready
                    </p>
                    <p className="text-[10px] text-emerald-600 leading-tight">
                      Using gemini-2.5-flash-image for standard results.
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 border-t border-stone-100 bg-stone-50 flex gap-3">
                <button 
                  onClick={() => setShowPromptPreview(false)}
                  className="flex-1 py-4 text-sm font-bold text-stone-600 hover:bg-stone-200 rounded-2xl transition-all"
                >
                  Edit Style
                </button>
                <button 
                  onClick={confirmGenerate}
                  className="flex-[2] py-4 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-2xl shadow-xl transition-all flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Generate Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Modal */}
      <AnimatePresence>
        {selectedComparison && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-[3rem] overflow-hidden max-w-5xl w-full shadow-2xl flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-900 text-white">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-black text-xl tracking-tight">Style Comparison</h3>
                    <p className="text-stone-400 text-xs">Before vs After Transformation</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedComparison(null)}
                  className="p-3 hover:bg-white/10 rounded-full transition-colors"
                >
                  <Trash2 className="w-6 h-6 text-white/60" />
                </button>
              </div>
              
              <div className="flex-1 overflow-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <div className="relative aspect-square rounded-[2rem] overflow-hidden border-4 border-stone-100 shadow-inner">
                      <img 
                        src={selectedComparison.originalImageUrl} 
                        alt="Original" 
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-4 left-4 px-4 py-2 bg-black/60 backdrop-blur-md text-white text-xs font-bold rounded-full uppercase tracking-widest">
                        Original
                      </div>
                      <button 
                        onClick={() => downloadImage(selectedComparison.originalImageUrl, `original-${selectedComparison.id}.png`)}
                        className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full text-white transition-all"
                        title="Download Original"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="relative aspect-square rounded-[2rem] overflow-hidden border-4 border-emerald-100 shadow-inner">
                      <img 
                        src={selectedComparison.generatedImageUrl} 
                        alt="Generated" 
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-4 left-4 px-4 py-2 bg-emerald-600 backdrop-blur-md text-white text-xs font-bold rounded-full uppercase tracking-widest">
                        New Look
                      </div>
                      <button 
                        onClick={() => downloadImage(selectedComparison.generatedImageUrl, `generated-${selectedComparison.id}.png`)}
                        className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full text-white transition-all"
                        title="Download Result"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 bg-stone-50 rounded-3xl border border-stone-100">
                    <h4 className="text-xs font-black uppercase tracking-widest text-stone-400 mb-2">AI Generation Details</h4>
                    <p className="text-sm text-stone-600 leading-relaxed italic">
                      "{selectedComparison.prompt}"
                    </p>
                  </div>
                  
                  {selectedComparison.barberTalk && (
                    <div className="p-6 bg-stone-900 rounded-3xl border border-stone-800 shadow-xl">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400">How to tell your Barber (Tanglish)</h4>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => downloadImage(selectedComparison.generatedImageUrl, `hairstyle-${selectedComparison.id}.png`)}
                            className="p-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                            title="Download Result"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              const element = document.createElement("a");
                              const file = new Blob([selectedComparison.barberTalk || ''], {type: 'text/plain'});
                              element.href = URL.createObjectURL(file);
                              element.download = `barber-instructions-${selectedComparison.id}.txt`;
                              document.body.appendChild(element);
                              element.click();
                            }}
                            className="p-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                            title="Download Instructions (TXT)"
                          >
                            <FileText className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => {
                              navigator.clipboard.writeText(selectedComparison.barberTalk || '');
                              setCopied(true);
                              setTimeout(() => setCopied(false), 2000);
                            }}
                            className="p-2 bg-white/10 text-white rounded-lg hover:bg-white/20 transition-all"
                          >
                            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <p className="text-lg text-white font-medium leading-relaxed">
                        {selectedComparison.barberTalk}
                      </p>
                      <p className="mt-4 text-[10px] text-stone-500 font-bold uppercase tracking-widest">
                        Show this to your barber or read it out loud
                      </p>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-6 border-t border-stone-100 bg-stone-50 flex justify-end gap-3">
                <button 
                  onClick={() => setSelectedComparison(null)}
                  className="px-8 py-3 text-sm font-bold text-stone-600 hover:bg-stone-200 rounded-2xl transition-all"
                >
                  Close
                </button>
                <button 
                  onClick={() => downloadImage(selectedComparison.generatedImageUrl, `hairstyle-${selectedComparison.id}.png`)}
                  className="px-8 py-3 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-2xl shadow-lg transition-all flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Result
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camera Modal */}
      <AnimatePresence>
        {showCamera && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl overflow-hidden max-w-lg w-full shadow-2xl"
            >
              <div className="p-4 border-b border-stone-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold">{isMultiCapture ? "360° Head Capture" : "Take a Photo"}</h3>
                  {isMultiCapture && (
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                      Step {['front', 'left', 'right', 'back'].indexOf(currentCaptureStep) + 1} of 4: {currentCaptureStep} view
                    </p>
                  )}
                </div>
                <button onClick={stopCamera} className="p-2 hover:bg-stone-100 rounded-full">
                  <Trash2 className="w-5 h-5 text-stone-400" />
                </button>
              </div>
              <div className="relative aspect-[3/4] bg-black">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  className={cn(
                    "w-full h-full object-cover",
                    facingMode === 'user' ? "scale-x-[-1]" : ""
                  )} 
                />
                <canvas ref={canvasRef} className="hidden" />
                
                {/* 360 Overlay Guide */}
                {isMultiCapture && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-56 h-72 border-2 border-emerald-400/50 rounded-[3rem] shadow-[0_0_0_1000px_rgba(0,0,0,0.5)]" />
                    <div className="absolute bottom-10 left-0 right-0 text-center">
                      <p className="text-white text-sm font-black uppercase tracking-widest drop-shadow-lg">
                        {currentCaptureStep === 'front' && "Look Straight Ahead"}
                        {currentCaptureStep === 'left' && "Turn Head to the Left"}
                        {currentCaptureStep === 'right' && "Turn Head to the Right"}
                        {currentCaptureStep === 'back' && "Show the Back of Head"}
                      </p>
                    </div>
                  </div>
                )}
                
                <div className="absolute top-4 right-4 flex flex-col gap-2">
                  <button 
                    onClick={toggleFlash}
                    className={cn(
                      "p-3 backdrop-blur-md rounded-full text-white transition-all border border-white/10",
                      flash ? "bg-yellow-500/80" : "bg-black/50 hover:bg-black/70"
                    )}
                    title="Toggle Flash"
                  >
                    {flash ? <Zap className="w-5 h-5 fill-current" /> : <ZapOff className="w-5 h-5" />}
                  </button>
                  <button 
                    onClick={toggleCamera}
                    className="p-3 bg-black/50 backdrop-blur-md rounded-full text-white hover:bg-black/70 transition-all border border-white/10"
                    title="Switch Camera"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                  <label className="p-3 bg-black/50 backdrop-blur-md rounded-full text-white hover:bg-black/70 transition-all border border-white/10 cursor-pointer">
                    <Camera className="w-5 h-5" />
                    <input 
                      type="file" 
                      accept="image/*" 
                      capture="user" 
                      className="hidden" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const dataUrl = event.target?.result as string;
                            const compressed = await compressImage(dataUrl);
                            
                            if (isMultiCapture) {
                              setMultiPhotos(prev => ({ ...prev, [currentCaptureStep]: compressed }));
                              if (currentCaptureStep === 'front') setCurrentCaptureStep('left');
                              else if (currentCaptureStep === 'left') setCurrentCaptureStep('right');
                              else if (currentCaptureStep === 'right') setCurrentCaptureStep('back');
                              else {
                                setSelectedImage(compressed);
                                setSuggestions([]);
                                stopCamera();
                                setIsMultiCapture(false);
                              }
                            } else {
                              setSelectedImage(compressed);
                              setSuggestions([]);
                              stopCamera();
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="p-6 flex justify-center">
                <button 
                  onClick={capturePhoto}
                  className="w-16 h-16 bg-stone-900 rounded-full flex items-center justify-center border-4 border-stone-200 hover:scale-105 active:scale-95 transition-all"
                >
                  <div className="w-12 h-12 rounded-full border-2 border-white" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Care Tips Modal */}
      <AnimatePresence>
        {showCareTips && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white rounded-3xl overflow-hidden max-w-2xl w-full shadow-2xl flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-900 text-white">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/10 rounded-xl">
                    <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl">Hair & Beard Care Tips</h3>
                    <p className="text-xs text-stone-400">Essential elements for healthy growth</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowCareTips(false)} 
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <Trash2 className="w-5 h-5 text-stone-400" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {careTips.map((tip, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="p-4 rounded-2xl bg-stone-50 border border-stone-100 hover:border-emerald-200 transition-colors group"
                    >
                      <h4 className="font-bold text-stone-900 mb-1 group-hover:text-emerald-600 transition-colors">{tip.element}</h4>
                      <p className="text-sm text-stone-500 leading-relaxed">{tip.tip}</p>
                    </motion.div>
                  ))}
                </div>
                
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                  <h4 className="font-bold text-emerald-900 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    General Advice
                  </h4>
                  <ul className="text-sm text-emerald-800 space-y-2 list-disc list-inside">
                    <li>Stay hydrated; water is essential for hair health.</li>
                    <li>Avoid excessive heat styling which can damage the hair shaft.</li>
                    <li>Regular trims help prevent split ends and maintain shape.</li>
                    <li>Massage your scalp to improve blood circulation to the follicles.</li>
                  </ul>
                </div>
              </div>

              <div className="p-6 border-t border-stone-100 bg-stone-50 flex justify-end">
                <button 
                  onClick={() => setShowCareTips(false)}
                  className="px-6 py-2 bg-stone-900 text-white rounded-xl font-bold hover:bg-stone-800 transition-colors"
                >
                  Got it
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HairStyleApp />
    </ErrorBoundary>
  );
}
