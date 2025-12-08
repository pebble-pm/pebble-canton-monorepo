/**
 * Close Market Button
 *
 * Button with confirmation dialog to close a market
 */

import { useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useCloseMarket } from "@/api/admin";

interface CloseMarketButtonProps {
    marketId: string;
}

export function CloseMarketButton({ marketId }: CloseMarketButtonProps) {
    const [open, setOpen] = useState(false);
    const closeMarket = useCloseMarket();

    const handleClose = async () => {
        try {
            await closeMarket.mutateAsync(marketId);
            toast.success("Market closed successfully. Trading is now disabled.");
            setOpen(false);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to close market");
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Lock className="mr-1 h-3 w-3" />
                    Close
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Close Market?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will stop all trading on this market. Users will no longer be able to place orders. This
                        action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClose} disabled={closeMarket.isPending}>
                        {closeMarket.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Close Market
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
