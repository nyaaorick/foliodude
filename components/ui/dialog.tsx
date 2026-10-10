"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/** Past this much downward travel, releasing dismisses instead of springing back. */
const SHEET_DISMISS_PX = 96

/**
 * Swipe-down-to-dismiss for the sheet layout.
 *
 * The drag is applied straight to the popup's inline transform rather than to
 * React state — a re-render per touchmove drops frames on a mid-range phone.
 * Dismissal clicks a hidden `Dialog.Close`, which keeps Base UI's own close
 * sequencing (focus restore, exit animation) intact without reaching for
 * internal context.
 */
function useSheetDrag(
  popupRef: React.RefObject<HTMLDivElement | null>,
  closeRef: React.RefObject<HTMLButtonElement | null>
) {
  const startY = React.useRef<number | null>(null)

  const setOffset = (px: number | null) => {
    const popup = popupRef.current
    if (!popup) return
    popup.style.transition = px === null ? "transform 150ms ease-out" : "none"
    popup.style.transform = px === null ? "" : `translateY(${px}px)`
  }

  return {
    onTouchStart: (event: React.TouchEvent) => {
      startY.current = event.touches[0].clientY
    },
    onTouchMove: (event: React.TouchEvent) => {
      if (startY.current === null) return
      // Clamp at 0 so an upward swipe cannot tear the sheet off its edge.
      setOffset(Math.max(0, event.touches[0].clientY - startY.current))
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (startY.current === null) return
      const travel = event.changedTouches[0].clientY - startY.current
      startY.current = null
      setOffset(null)

      if (travel > SHEET_DISMISS_PX) {
        closeRef.current?.click()
      }
    },
  }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const drag = useSheetDrag(popupRef, closeRef)

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={popupRef}
        data-slot="dialog-content"
        className={cn(
          "fixed z-50 grid gap-4 bg-background text-sm ring-1 ring-foreground/10 duration-150 outline-none",
          // Below `md` — the Firefox sidebar and iOS portrait — the dialog is a
          // bottom sheet: pinned to the thumb end of the screen, full width, and
          // height-capped so a long form scrolls inside the sheet rather than
          // pushing its actions off-screen.
          "inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
          "data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          // At `md` and up it reverts to a centred modal.
          "md:inset-x-auto md:bottom-auto md:top-1/2 md:left-1/2 md:w-full md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:pb-4",
          "md:data-open:slide-in-from-bottom-0 md:data-open:zoom-in-95 md:data-closed:slide-out-to-bottom-0 md:data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {/* Grab handle. Only the handle drags, so content stays scrollable. */}
        <div
          aria-hidden="true"
          className="-mt-1 flex cursor-grab justify-center pb-1 md:hidden"
          {...drag}
        >
          <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
        </div>

        {children}

        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}

        {/* Swipe-dismiss target for `useSheetDrag`; never focusable or visible. */}
        <DialogPrimitive.Close ref={closeRef} tabIndex={-1} className="hidden" />
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // The negative margins let the footer bleed to the sheet's edges; the
        // bottom one has to cancel the popup's safe-area padding, not just p-4.
        "-mx-4 -mb-[calc(1rem+env(safe-area-inset-bottom))] flex flex-col-reverse gap-2 border-t bg-muted/50 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
        "md:-mb-4 md:flex-row md:justify-end md:rounded-b-xl md:pb-4",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
}
