/**
 * Create Market Dialog
 *
 * Form for creating new prediction markets
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useCreateMarket } from "@/api/admin";

// Form validation schema
const createMarketSchema = z.object({
    question: z
        .string()
        .min(10, "Question must be at least 10 characters")
        .max(500, "Question must be less than 500 characters"),
    description: z.string().max(2000, "Description must be less than 2000 characters").optional(),
    resolutionDate: z.date({ error: "Resolution date is required" }),
    resolutionTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Invalid time format (HH:MM)"),
});

type CreateMarketFormData = z.infer<typeof createMarketSchema>;

export function CreateMarketDialog() {
    const [open, setOpen] = useState(false);
    const createMarket = useCreateMarket();

    const form = useForm<CreateMarketFormData>({
        resolver: zodResolver(createMarketSchema),
        defaultValues: {
            question: "",
            description: "",
            resolutionTime: "12:00",
        },
    });

    const onSubmit = async (data: CreateMarketFormData) => {
        try {
            // Combine date and time
            const [hours, minutes] = data.resolutionTime.split(":").map(Number);
            const resolutionDateTime = new Date(data.resolutionDate);
            resolutionDateTime.setHours(hours, minutes, 0, 0);

            // Check if combined datetime is in the future
            if (resolutionDateTime <= new Date()) {
                toast.error("Resolution time must be in the future");
                return;
            }

            await createMarket.mutateAsync({
                question: data.question,
                description: data.description || undefined,
                resolutionTime: resolutionDateTime.toISOString(),
            });

            toast.success("Market created successfully");
            setOpen(false);
            form.reset();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to create market");
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Market
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create New Market</DialogTitle>
                    <DialogDescription>
                        Create a new prediction market. Users will be able to trade on the outcome.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {/* Question */}
                    <div className="space-y-2">
                        <Label htmlFor="question">Question</Label>
                        <Input
                            id="question"
                            placeholder="Will Bitcoin reach $100,000 by end of 2025?"
                            {...form.register("question")}
                        />
                        <p className="text-xs text-muted-foreground">A clear yes/no question for the market</p>
                        {form.formState.errors.question && (
                            <p className="text-xs text-destructive">{form.formState.errors.question.message}</p>
                        )}
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <Label htmlFor="description">Description (Optional)</Label>
                        <Textarea
                            id="description"
                            placeholder="Additional context or resolution criteria..."
                            className="resize-none"
                            rows={3}
                            {...form.register("description")}
                        />
                        <p className="text-xs text-muted-foreground">
                            Provide additional details about resolution criteria
                        </p>
                        {form.formState.errors.description && (
                            <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>
                        )}
                    </div>

                    {/* Resolution Date */}
                    <div className="space-y-2">
                        <Label>Resolution Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className={cn(
                                        "w-full justify-start text-left font-normal",
                                        !form.watch("resolutionDate") && "text-muted-foreground",
                                    )}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {form.watch("resolutionDate") ? (
                                        format(form.watch("resolutionDate"), "PPP")
                                    ) : (
                                        <span>Pick a date</span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="single"
                                    selected={form.watch("resolutionDate")}
                                    onSelect={(date) => form.setValue("resolutionDate", date as Date)}
                                    disabled={(date) => date < new Date()}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                        {form.formState.errors.resolutionDate && (
                            <p className="text-xs text-destructive">{form.formState.errors.resolutionDate.message}</p>
                        )}
                    </div>

                    {/* Resolution Time */}
                    <div className="space-y-2">
                        <Label htmlFor="resolutionTime">Resolution Time (UTC)</Label>
                        <Input id="resolutionTime" type="time" {...form.register("resolutionTime")} />
                        {form.formState.errors.resolutionTime && (
                            <p className="text-xs text-destructive">{form.formState.errors.resolutionTime.message}</p>
                        )}
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={createMarket.isPending}>
                            {createMarket.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Create Market
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
