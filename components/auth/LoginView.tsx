"use client"

import type React from "react"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Loader2, Lock, Mail, Music, Utensils, Coffee } from "lucide-react"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { supabase } from "@/lib/db/client"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface LoginViewProps {
  onLoginSuccess: () => void
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [animationComplete, setAnimationComplete] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    // Trigger animation after component mounts
    const timer = setTimeout(() => {
      setAnimationComplete(true)
    }, 500)
    return () => clearTimeout(timer)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      toast({
        title: "Campos requeridos",
        description: "Por favor ingresa tu email y contraseña",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        throw error
      }

      toast({
        title: "Inicio de sesión exitoso",
        description: "Bienvenido al sistema VibePOS",
      })

      onLoginSuccess()
    } catch (error: any) {
      toast({
        title: "Error al iniciar sesión",
        description: error.message || "Verifica tus credenciales e intenta nuevamente",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-purple-900 via-violet-800 to-indigo-900 dark:from-purple-950 dark:via-violet-900 dark:to-indigo-950 p-4 overflow-hidden">
      <div className="absolute top-4 right-4 z-50">
        <ThemeToggle />
      </div>

      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-purple-500/20 rounded-full blur-3xl animate-pulse"></div>
        <div
          className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        ></div>
        <div
          className="absolute top-2/3 left-1/2 w-72 h-72 bg-violet-500/20 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "2s" }}
        ></div>
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div
          className={cn(
            "text-center transform transition-all duration-700",
            animationComplete ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0",
          )}
        >
          <div className="flex items-center justify-center mb-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600 to-indigo-600 rounded-full blur-md animate-pulse"></div>
              <div className="relative bg-white dark:bg-gray-900 rounded-full p-3 shadow-xl">
                <Music className="h-8 w-8 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div className="relative ml-3">
              <div
                className="absolute inset-0 bg-gradient-to-r from-indigo-600 to-violet-600 rounded-full blur-md animate-pulse"
                style={{ animationDelay: "0.5s" }}
              ></div>
              <div className="relative bg-white dark:bg-gray-900 rounded-full p-3 shadow-xl">
                <Utensils className="h-8 w-8 text-indigo-600 dark:text-indigo-400" />
              </div>
            </div>
          </div>
          <h1 className="text-5xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400">
            VibePOS
          </h1>
          <p className="mt-2 text-white/80 dark:text-white/70">
            Sistema de punto de venta con estilo para restaurantes
          </p>
        </div>

        <Card
          className={cn(
            "border-0 shadow-2xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-md transform transition-all duration-700 delay-300 relative z-20",
            animationComplete ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0",
          )}
        >
          <div className="absolute inset-0 border border-white/20 dark:border-white/10 rounded-lg"></div>
          <div className="absolute -top-5 -right-5">
            <div className="relative">
              <div
                className="absolute inset-0 bg-gradient-to-r from-violet-600 to-purple-600 rounded-full blur-md animate-pulse"
                style={{ animationDelay: "1s" }}
              ></div>
              <div className="relative bg-white dark:bg-gray-900 rounded-full p-3 shadow-xl">
                <Coffee className="h-6 w-6 text-violet-600 dark:text-violet-400" />
              </div>
            </div>
          </div>

          <CardHeader className="relative">
            <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-600 to-indigo-600 dark:from-purple-400 dark:to-indigo-400">
              Iniciar sesión
            </CardTitle>
            <CardDescription className="text-gray-600 dark:text-gray-400">
              Ingresa tus credenciales para acceder al sistema
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleLogin}>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-700 dark:text-gray-300">
                  Email
                </Label>
                <div className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-indigo-500/20 rounded-md blur-sm group-focus-within:opacity-100 opacity-0 transition-opacity pointer-events-none"></div>
                  <div className="absolute left-0 top-0 bottom-0 w-10 flex items-center justify-center pointer-events-none">
                    <Mail className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@email.com"
                    className="pl-10 bg-white/50 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 focus:border-purple-500 dark:focus:border-purple-400 focus:ring-purple-500 dark:focus:ring-purple-400 transition-all relative z-10"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-700 dark:text-gray-300">
                  Contraseña
                </Label>
                <div className="relative group">
                  <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 rounded-md blur-sm group-focus-within:opacity-100 opacity-0 transition-opacity pointer-events-none"></div>
                  <div className="absolute left-0 top-0 bottom-0 w-10 flex items-center justify-center pointer-events-none">
                    <Lock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-10 bg-white/50 dark:bg-gray-800/50 border-gray-300 dark:border-gray-700 focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-indigo-500 dark:focus:ring-indigo-400 transition-all relative z-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter>
              <Button
                type="submit"
                className="w-full relative overflow-hidden group bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white border-0"
                disabled={isLoading}
              >
                <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-purple-600/0 via-white/20 to-indigo-600/0 transform -skew-x-12 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Iniciando sesión...
                  </>
                ) : (
                  "Iniciar sesión"
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <div
          className={cn(
            "text-center text-white/60 dark:text-white/40 text-sm transform transition-all duration-700 delay-500",
            animationComplete ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0",
          )}
        >
          © {new Date().getFullYear()} VibePOS • Todos los derechos reservados
        </div>
      </div>
    </div>
  )
}
