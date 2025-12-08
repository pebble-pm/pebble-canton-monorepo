/**
 * Party Selector Component
 *
 * Allows users to select an existing party or create a new one
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Plus, UserCircle, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useParties, useAllocateParty, useLogin } from "@/api/parties";
import { toast } from "sonner";

// Form schemas
const loginSchema = z.object({
    partyId: z.string().min(1, "Please select a party"),
});

const createSchema = z.object({
    displayName: z.string().min(1, "Display name is required").max(50),
});

type LoginFormData = z.infer<typeof loginSchema>;
type CreateFormData = z.infer<typeof createSchema>;

interface PartySelectorProps {
    onSuccess?: () => void;
}

export function PartySelector({ onSuccess }: PartySelectorProps) {
    const [activeTab, setActiveTab] = useState<"existing" | "new">("existing");
    const [showSystemParties, setShowSystemParties] = useState(false);

    // API hooks
    const { data: parties, isLoading: isLoadingParties } = useParties(showSystemParties);
    const loginMutation = useLogin();
    const allocateMutation = useAllocateParty();

    // Login form
    const loginForm = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            partyId: "",
        },
    });

    // Create form
    const createForm = useForm<CreateFormData>({
        resolver: zodResolver(createSchema),
        defaultValues: {
            displayName: "",
        },
    });

    // Handle login with existing party
    const onLogin = async (data: LoginFormData) => {
        try {
            await loginMutation.mutateAsync({ partyId: data.partyId });
            toast.success("Logged in successfully");
            onSuccess?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Login failed");
        }
    };

    // Handle creating new party
    const onCreate = async (data: CreateFormData) => {
        try {
            const party = await allocateMutation.mutateAsync({
                displayName: data.displayName,
            });
            // Auto-login with new party
            await loginMutation.mutateAsync({ partyId: party.partyId });
            toast.success(`Created and logged in as ${data.displayName}`);
            onSuccess?.();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create party");
        }
    };

    const isLoading = loginMutation.isPending || allocateMutation.isPending || isLoadingParties;

    return (
        <Card className="w-full max-w-md">
            <CardHeader className="text-center">
                <CardTitle className="text-2xl">Welcome to Pebble</CardTitle>
                <CardDescription>Select an existing party or create a new one to start trading</CardDescription>
            </CardHeader>
            <CardContent>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "existing" | "new")}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="existing">
                            <UserCircle className="mr-2 h-4 w-4" />
                            Existing Party
                        </TabsTrigger>
                        <TabsTrigger value="new">
                            <Plus className="mr-2 h-4 w-4" />
                            New Party
                        </TabsTrigger>
                    </TabsList>

                    {/* Login with existing party */}
                    <TabsContent value="existing" className="mt-4">
                        <Form {...loginForm}>
                            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                                <FormField
                                    control={loginForm.control}
                                    name="partyId"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Select Party</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                value={field.value}
                                                disabled={isLoading}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Choose a party..." />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {parties?.map((party) => (
                                                        <SelectItem key={party.id} value={party.id}>
                                                            <span className="flex items-center gap-2">
                                                                {party.isSystem && (
                                                                    <Shield className="h-3 w-3 text-amber-500" />
                                                                )}
                                                                {party.displayName}
                                                            </span>
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormDescription>Pre-allocated test parties</FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div className="flex items-center space-x-2">
                                    <Checkbox
                                        id="showSystem"
                                        checked={showSystemParties}
                                        onCheckedChange={(checked) => setShowSystemParties(checked === true)}
                                    />
                                    <label
                                        htmlFor="showSystem"
                                        className="text-sm text-muted-foreground cursor-pointer"
                                    >
                                        Show system parties (Admin, Oracle)
                                    </label>
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Login
                                </Button>
                            </form>
                        </Form>
                    </TabsContent>

                    {/* Create new party */}
                    <TabsContent value="new" className="mt-4">
                        <Form {...createForm}>
                            <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
                                <FormField
                                    control={createForm.control}
                                    name="displayName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Display Name</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="Enter your name..."
                                                    {...field}
                                                    disabled={isLoading}
                                                />
                                            </FormControl>
                                            <FormDescription>
                                                This will be your identity on the Canton ledger
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {(allocateMutation.isPending || loginMutation.isPending) && (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    )}
                                    Create & Login
                                </Button>
                            </form>
                        </Form>
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}
