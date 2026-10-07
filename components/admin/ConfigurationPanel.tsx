"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useConfigStore } from "@/store/use-config-store"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Loader2, Save, RefreshCw } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export function ConfigurationPanel() {
  const {
    tipPercentage,
    taxPercentage,
    priceSuggestion,
    inventoryControlEnabled,
    businessName,
    businessAddress,
    businessPhone,
    businessNIT,
    setTipPercentage,
    setTaxPercentage,
    setPriceSuggestion,
    setInventoryControlEnabled,
    setBusinessInfo,
    isLoading,
    error,
    loadConfigFromDB,
    saveConfigToDB,
  } = useConfigStore()

  const [localTipPercentage, setLocalTipPercentage] = useState(tipPercentage)
  const [localTaxPercentage, setLocalTaxPercentage] = useState(taxPercentage)
  const [localPriceSuggestion, setLocalPriceSuggestion] = useState(priceSuggestion)
  const [localInventoryControlEnabled, setLocalInventoryControlEnabled] = useState(inventoryControlEnabled)
  const [localBusinessInfo, setLocalBusinessInfo] = useState({
    name: businessName,
    address: businessAddress,
    phone: businessPhone,
    nit: businessNIT,
  })
  const { toast } = useToast()

  // Cargar la configuración desde la base de datos al montar el componente
  useEffect(() => {
    loadConfigFromDB()
  }, [loadConfigFromDB])

  // Actualizar el estado local cuando cambian los valores del store
  useEffect(() => {
    setLocalTipPercentage(tipPercentage)
    setLocalTaxPercentage(taxPercentage)
    setLocalPriceSuggestion(priceSuggestion)
    setLocalInventoryControlEnabled(inventoryControlEnabled)
    setLocalBusinessInfo({
      name: businessName,
      address: businessAddress,
      phone: businessPhone,
      nit: businessNIT,
    })
  }, [
    tipPercentage,
    taxPercentage,
    inventoryControlEnabled,
    businessName,
    businessAddress,
    businessPhone,
    businessNIT,
  ])

  // Mostrar errores si ocurren
  useEffect(() => {
    if (error) {
      toast({
        title: "Error",
        description: error,
        variant: "destructive",
      })
    }
  }, [error, toast])

  const handleSaveTaxAndTip = async () => {
    setTipPercentage(localTipPercentage)
    setTaxPercentage(localTaxPercentage)
    setPriceSuggestion(localPriceSuggestion)
    setInventoryControlEnabled(localInventoryControlEnabled)

    try {
      await saveConfigToDB()
      toast({
        title: "Configuración guardada",
        description: "Los cambios se han guardado correctamente.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudieron guardar los cambios. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  const handleSaveBusinessInfo = async () => {
    setBusinessInfo(localBusinessInfo)

    try {
      await saveConfigToDB()
      toast({
        title: "Información guardada",
        description: "La información del negocio se ha guardado correctamente.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar la información. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  const handleRefresh = async () => {
    try {
      await loadConfigFromDB()
      toast({
        title: "Configuración actualizada",
        description: "Se ha cargado la configuración más reciente.",
      })
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo cargar la configuración. Intente nuevamente.",
        variant: "destructive",
      })
    }
  }

  return (
    <Tabs defaultValue="taxes">
      <div className="flex justify-between items-center mb-4">
        <TabsList>
          <TabsTrigger value="taxes">Impuestos y Propinas</TabsTrigger>
          <TabsTrigger value="business">Información del Negocio</TabsTrigger>
          <TabsTrigger value="inventory">Control de Inventario</TabsTrigger>
        </TabsList>

        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Actualizar
        </Button>
      </div>

      <TabsContent value="taxes">
        <Card>
          <CardHeader>
            <CardTitle>Configuración de Impuestos y Propinas</CardTitle>
            <CardDescription>
              Ajuste los porcentajes de impuestos y propinas que se aplicarán a las órdenes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-2">
                  <Label htmlFor="tipPercentage">Porcentaje de Propina</Label>
                  <span className="font-medium">{localTipPercentage}%</span>
                </div>
                <Slider
                  id="tipPercentage"
                  value={[localTipPercentage]}
                  onValueChange={(value) => setLocalTipPercentage(value[0])}
                  min={0}
                  max={20}
                  step={1}
                  className="mb-2"
                  disabled={isLoading}
                />
                <p className="text-sm text-muted-foreground">
                  Este es el porcentaje de propina sugerido que se mostrará en las facturas.
                </p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <Label htmlFor="taxPercentage">Porcentaje de Impuesto</Label>
                  <span className="font-medium">{localTaxPercentage}%</span>
                </div>
                <Slider
                  id="taxPercentage"
                  value={[localTaxPercentage]}
                  onValueChange={(value) => setLocalTaxPercentage(value[0])}
                  min={0}
                  max={20}
                  step={1}
                  className="mb-2"
                  disabled={isLoading}
                />
                <p className="text-sm text-muted-foreground">
                  Este es el porcentaje de impuesto que se aplicará a todas las órdenes.
                </p>
              </div>

              
              <div>
                <div className="flex justify-between mb-2">
                  <Label htmlFor="taxPercentage">Porcentaje de precio sugerido para la venta</Label>
                  <span className="font-medium">{localPriceSuggestion}%</span>
                </div>
                <Slider
                    id="taxPercentage"
                    value={[localPriceSuggestion]}
                    onValueChange={(value) => setLocalPriceSuggestion(value[0])}
                    min={50}
                    max={500}
                    step={10}
                    className="mb-2"
                    disabled={isLoading}
                />
                <p className="text-sm text-muted-foreground">
                  Este es el porcentaje de aumento en precio que se sugerirá para la venta.
                </p>
              </div>

            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveTaxAndTip} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar Configuración
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="business">
        <Card>
          <CardHeader>
            <CardTitle>Información del Negocio</CardTitle>
            <CardDescription>Esta información aparecerá en las facturas y comandas impresas.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="businessName">Nombre del Negocio</Label>
              <Input
                id="businessName"
                value={localBusinessInfo.name}
                onChange={(e) => setLocalBusinessInfo({ ...localBusinessInfo, name: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessAddress">Dirección</Label>
              <Input
                id="businessAddress"
                value={localBusinessInfo.address}
                onChange={(e) => setLocalBusinessInfo({ ...localBusinessInfo, address: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessPhone">Teléfono</Label>
              <Input
                id="businessPhone"
                value={localBusinessInfo.phone}
                onChange={(e) => setLocalBusinessInfo({ ...localBusinessInfo, phone: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="businessNIT">NIT</Label>
              <Input
                id="businessNIT"
                value={localBusinessInfo.nit}
                onChange={(e) => setLocalBusinessInfo({ ...localBusinessInfo, nit: e.target.value })}
                disabled={isLoading}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveBusinessInfo} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar Información
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>

      <TabsContent value="inventory">
        <Card>
          <CardHeader>
            <CardTitle>Control de Inventario</CardTitle>
            <CardDescription>Configure las opciones de control de inventario para su restaurante.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="inventoryControl">Control de Inventario</Label>
                <p className="text-sm text-muted-foreground">
                  Activa el control automático de inventario al enviar órdenes a cocina.
                </p>
              </div>
              <Switch
                id="inventoryControl"
                checked={localInventoryControlEnabled}
                onCheckedChange={setLocalInventoryControlEnabled}
                disabled={isLoading}
              />
            </div>

            <div className="rounded-md bg-amber-50 p-4 border border-amber-200">
              <h4 className="text-sm font-medium text-amber-800 mb-2">Información importante</h4>
              <p className="text-sm text-amber-700">Al activar el control de inventario:</p>
              <ul className="list-disc list-inside text-sm text-amber-700 mt-2 space-y-1">
                <li>Se verificará el stock de ingredientes al enviar órdenes a cocina</li>
                <li>Se descontará automáticamente el stock de los ingredientes</li>
                <li>Los platos sin stock suficiente se mostrarán como "Agotado"</li>
                <li>Los platos sin receta definida no serán afectados</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSaveTaxAndTip} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Guardar Configuración
            </Button>
          </CardFooter>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
