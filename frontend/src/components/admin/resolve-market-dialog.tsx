/**
 * Resolve Market Dialog
 *
 * Dialog to resolve a market with YES or NO outcome
 */

import { useState } from "react";
import { CheckCircle, XCircle, Loader2, Gavel } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useResolveMarket } from "@/api/admin";

interface ResolveMarketDialogProps {
    marketId: string;
    question: string;
}

export function ResolveMarketDialog({ marketId, question }: ResolveMarketDialogProps) {
    const [open, setOpen] = useState(false);
    const [selectedOutcome, setSelectedOutcome] = useState<boolean | null>(null);
    const resolveMarket = useResolveMarket();

    const handleResolve = async () => {
        if (selectedOutcome === null) {
            toast.error("Please select an outcome");
            return;
        }

        try {
            await resolveMarket.mutateAsync({ marketId, outcome: selectedOutcome });
            toast.success(`Market resolved as ${selectedOutcome ? "YES" : "NO"}. Winners can now redeem.`);
            setOpen(false);
            setSelectedOutcome(null);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to resolve market");
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(isOpen) => {
                setOpen(isOpen);
                if (!isOpen) setSelectedOutcome(null);
            }}
        >
            <DialogTrigger asChild>
                <Button variant="default" size="sm">
                    <Gavel className="mr-1 h-3 w-3" />
                    Resolve
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Resolve Market</DialogTitle>
                    <DialogDescription>
                        Select the final outcome for this market. This action is permanent and will allow winning positions to be redeemed.
                    </DialogDescription>
                </DialogHeader>

                <div className="py-4">
                    <p className="text-sm font-medium mb-4">{question}</p>

                    <div className="grid grid-cols-2 gap-4">
                        <Button
                            variant={selectedOutcome === true ? "default" : "outline"}
                            className={selectedOutcome === true ? "bg-green-600 hover:bg-green-700" : ""}
                            onClick={() => setSelectedOutcome(true)}
                        >
                            <CheckCircle className="mr-2 h-4 w-4" />
                            YES
                        </Button>
                        <Button
                            variant={selectedOutcome === false ? "default" : "outline"}
                            className={selectedOutcome === false ? "bg-red-600 hover:bg-red-700" : ""}
                            onClick={() => setSelectedOutcome(false)}
                        >
                            <XCircle className="mr-2 h-4 w-4" />
                            NO
                        </Button>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleResolve} disabled={selectedOutcome === null || resolveMarket.isPending}>
                        {resolveMarket.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirm Resolution
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
