import React from "react";
import { User, Lock } from "lucide-react";

export function Hearth() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet" />
      
      <div 
        className="min-h-screen flex items-center justify-center p-4 sm:p-8"
        style={{
          fontFamily: "'DM Sans', sans-serif",
          backgroundColor: "#fdfbf7",
          backgroundImage: "radial-gradient(circle at 50% 0%, #fff7ed 0%, #fdfbf7 50%, #faf6f0 100%)",
          color: "#432c1a"
        }}
      >
        {/* Grain overlay */}
        <div 
          className="fixed inset-0 pointer-events-none opacity-[0.15]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
          }}
        />

        <div 
          className="w-full max-w-md relative z-10 p-8 sm:p-10 rounded-[32px]"
          style={{
            backgroundColor: "#ffffff",
            boxShadow: "0 20px 40px -10px rgba(180, 110, 60, 0.08), 0 0 0 1px rgba(220, 180, 150, 0.2)",
          }}
        >
          <div className="text-center mb-10">
            <h1 
              className="text-4xl sm:text-5xl mb-3"
              style={{
                fontFamily: "'Fraunces', serif",
                fontWeight: 600,
                color: "#2d1b0f",
                letterSpacing: "-0.02em"
              }}
            >
              Welcome back
            </h1>
            <p className="text-[#8c6b52] text-base sm:text-lg">
              Sign in to your homelab dashboard
            </p>
          </div>

          <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-[#6b4a31] ml-1">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User size={18} color="#bba391" />
                </div>
                <input 
                  type="text" 
                  placeholder="Enter your username"
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl outline-none transition-all"
                  style={{
                    backgroundColor: "#fcfaf8",
                    border: "1px solid #e8ddd5",
                    color: "#432c1a"
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#d97736";
                    e.target.style.boxShadow = "0 0 0 4px rgba(217, 119, 54, 0.1)";
                    e.target.style.backgroundColor = "#ffffff";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "#e8ddd5";
                    e.target.style.boxShadow = "none";
                    e.target.style.backgroundColor = "#fcfaf8";
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-[#6b4a31] ml-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock size={18} color="#bba391" />
                </div>
                <input 
                  type="password" 
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl outline-none transition-all"
                  style={{
                    backgroundColor: "#fcfaf8",
                    border: "1px solid #e8ddd5",
                    color: "#432c1a"
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#d97736";
                    e.target.style.boxShadow = "0 0 0 4px rgba(217, 119, 54, 0.1)";
                    e.target.style.backgroundColor = "#ffffff";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "#e8ddd5";
                    e.target.style.boxShadow = "none";
                    e.target.style.backgroundColor = "#fcfaf8";
                  }}
                />
              </div>
            </div>

            <button 
              type="submit"
              className="w-full mt-8 py-4 px-6 rounded-2xl font-medium text-lg transition-all"
              style={{
                backgroundColor: "#d97736",
                color: "#ffffff",
                boxShadow: "0 4px 14px rgba(217, 119, 54, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)",
                textShadow: "0 1px 2px rgba(0,0,0,0.1)"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "#c96624";
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(217, 119, 54, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "#d97736";
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 14px rgba(217, 119, 54, 0.25), inset 0 1px 0 rgba(255,255,255,0.2)";
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = "translateY(1px)";
                e.currentTarget.style.boxShadow = "0 2px 8px rgba(217, 119, 54, 0.2), inset 0 1px 0 rgba(0,0,0,0.1)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = "translateY(-1px)";
                e.currentTarget.style.boxShadow = "0 6px 20px rgba(217, 119, 54, 0.3), inset 0 1px 0 rgba(255,255,255,0.2)";
              }}
            >
              Sign in
            </button>
          </form>

          <div className="mt-10 text-center">
            <p className="text-[#8c6b52]">
              Don't have an account?{" "}
              <a 
                href="#" 
                className="font-medium hover:underline transition-colors"
                style={{ color: "#bd5a1a" }}
              >
                Register here
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
