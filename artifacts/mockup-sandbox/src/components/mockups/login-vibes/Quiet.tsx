import React from "react";
import { ArrowRight } from "lucide-react";

export function Quiet() {
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        .font-quiet { font-family: 'Outfit', sans-serif; }
      `}} />
      <div className="min-h-screen flex items-center justify-center bg-[#F9F9F8] font-quiet text-[#2A2A2A] selection:bg-[#E5E5E5]">
        <div className="w-full max-w-[420px] px-8 py-16 bg-[#FFFFFF] rounded-2xl shadow-[0_4px_40px_-10px_rgba(0,0,0,0.03)] border border-[#F0F0F0]">
          
          <div className="flex flex-col items-center mb-16 text-center">
            <h1 className="text-3xl font-light tracking-wide text-[#1A1A1A] mb-3">
              Welcome back
            </h1>
            <p className="text-sm font-light tracking-widest uppercase text-[#888888]">
              Sign in to your homelab dashboard
            </p>
          </div>

          <form className="space-y-8" onSubmit={(e) => e.preventDefault()}>
            <div className="space-y-8">
              <div className="relative group">
                <input 
                  type="text" 
                  id="username"
                  className="w-full bg-transparent border-b border-[#E5E5E5] px-0 py-3 text-[#1A1A1A] text-lg font-light focus:outline-none focus:border-[#1A1A1A] transition-colors peer placeholder-transparent"
                  placeholder="Username"
                />
                <label 
                  htmlFor="username"
                  className="absolute left-0 top-3 text-[#999999] text-lg font-light transition-all peer-focus:-top-4 peer-focus:text-xs peer-focus:text-[#1A1A1A] peer-focus:tracking-widest peer-focus:uppercase peer-[:not(:placeholder-shown)]:-top-4 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase"
                >
                  Username
                </label>
              </div>

              <div className="relative group">
                <input 
                  type="password" 
                  id="password"
                  className="w-full bg-transparent border-b border-[#E5E5E5] px-0 py-3 text-[#1A1A1A] text-lg font-light focus:outline-none focus:border-[#1A1A1A] transition-colors peer placeholder-transparent"
                  placeholder="Password"
                />
                <label 
                  htmlFor="password"
                  className="absolute left-0 top-3 text-[#999999] text-lg font-light transition-all peer-focus:-top-4 peer-focus:text-xs peer-focus:text-[#1A1A1A] peer-focus:tracking-widest peer-focus:uppercase peer-[:not(:placeholder-shown)]:-top-4 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:tracking-widest peer-[:not(:placeholder-shown)]:uppercase"
                >
                  Password
                </label>
              </div>
            </div>

            <div className="pt-8">
              <button 
                type="submit" 
                className="w-full flex items-center justify-between group py-4 border-b border-[#1A1A1A] text-[#1A1A1A] hover:text-white hover:bg-[#1A1A1A] hover:px-6 transition-all duration-500 ease-out"
              >
                <span className="text-sm font-light tracking-widest uppercase">Sign in</span>
                <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
              </button>
            </div>
          </form>

          <div className="mt-16 text-center">
            <p className="text-xs font-light text-[#999999] tracking-wider">
              Don't have an account?{' '}
              <a href="#" className="text-[#1A1A1A] hover:text-[#666666] transition-colors border-b border-transparent hover:border-[#666666] pb-0.5">
                Register here
              </a>
            </p>
          </div>

        </div>
      </div>
    </>
  );
}

export default Quiet;
