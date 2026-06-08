import React, { useState } from 'react';
import { Terminal, Lock, User, ChevronRight } from 'lucide-react';

export function Rack() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeout(() => setIsSubmitting(false), 1500);
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        .font-mono-rack {
          font-family: 'Space Mono', monospace;
        }

        .rack-scanline {
          background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2));
          background-size: 100% 4px;
        }

        .rack-grid {
          background-color: #0a0a0c;
          background-image: 
            linear-gradient(rgba(255, 176, 0, 0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 176, 0, 0.05) 1px, transparent 1px);
          background-size: 20px 20px;
        }
      `}} />
      <div className="min-h-screen text-[#a0a0a5] font-mono-rack flex items-center justify-center relative overflow-hidden rack-grid">
        <div className="absolute inset-0 rack-scanline pointer-events-none opacity-50 z-10" />
        
        <div className="relative z-20 w-full max-w-md p-8 border border-[#333] bg-[#0f0f12] shadow-2xl shadow-[#ffb000]/5">
          <div className="absolute top-0 left-0 w-full h-1 bg-[#ffb000] opacity-80" />
          
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <Terminal className="w-5 h-5 text-[#ffb000]" />
              <h1 className="text-xl font-bold text-white uppercase tracking-widest">Welcome back</h1>
            </div>
            <p className="text-sm text-[#7a7a85]">Sign in to your homelab dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-[#ffb000]">
                <User className="w-3.5 h-3.5" />
                Username
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#444]">
                  <span className="text-[#ffb000]">{'>'}</span>
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-[#050505] border border-[#333] focus:border-[#ffb000] text-white px-8 py-3 outline-none transition-colors"
                  placeholder="admin"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-[#ffb000]">
                <Lock className="w-3.5 h-3.5" />
                Password
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#444]">
                  <span className="text-[#ffb000]">{'>'}</span>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#050505] border border-[#333] focus:border-[#ffb000] text-white px-8 py-3 outline-none transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-[#ffb000] hover:bg-[#ffc13b] text-black font-bold uppercase tracking-widest py-3 px-4 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-70"
            >
              {isSubmitting ? (
                <>
                  <span className="animate-pulse">Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#222] text-center">
            <p className="text-xs text-[#7a7a85]">
              Don't have an account?{' '}
              <a href="#" className="text-[#ffb000] hover:text-white underline decoration-[#ffb000]/30 underline-offset-4 transition-colors">
                Register here
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
