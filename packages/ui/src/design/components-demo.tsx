"use client";

import * as React from "react";
import {
  ArrowUpDownIcon,
  CalendarIcon,
  CircleDashedIcon,
  CopyIcon,
  FolderIcon,
  InboxIcon,
  KanbanIcon,
  LayersIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  TagIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AvatarStack, PersonAvatar } from "@pantry/ui/components/avatar-stack";
import { PantryAvatar } from "@pantry/ui/components/pantry-avatar";
import { PantryAvatarPicker } from "@pantry/ui/components/pantry-avatar-picker";
import {
  PANTRY_SHAPE_NAMES,
  pickPantryAvatar,
  type PantryAvatarValue,
} from "@pantry/ui/lib/pantry-avatars";
import { Badge } from "@pantry/ui/components/badge";
import { Button } from "@pantry/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@pantry/ui/components/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@pantry/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@pantry/ui/components/context-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@pantry/ui/components/field";
import { Input } from "@pantry/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@pantry/ui/components/input-group";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { Keycap } from "@pantry/ui/components/keycap";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@pantry/ui/components/popover";
import { PriorityGlyph } from "@pantry/ui/components/priority-glyph";
import { SegmentedControl } from "@pantry/ui/components/segmented-control";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@pantry/ui/components/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@pantry/ui/components/sidebar";
import { Skeleton } from "@pantry/ui/components/skeleton";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pantry/ui/components/tabs";
import { Textarea } from "@pantry/ui/components/textarea";
import { ToggleGroup, ToggleGroupItem } from "@pantry/ui/components/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pantry/ui/components/tooltip";
import {
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABEL,
  type StatusCategory,
} from "@pantry/ui/lib/issue-meta";
import { useDesignBrand } from "./brand";
import { Section, Specimen, SubSection } from "./section";

const PEOPLE = [
  { id: "k", name: "Kris Owner" },
  { id: "p", name: "Partner Member" },
  { id: "a", name: "Ada Lovelace" },
  { id: "g", name: "Grace Hopper" },
  { id: "l", name: "Linus Pauling" },
];

const STATUS_KEYS: Record<StatusCategory, string> = {
  backlog: "1",
  unstarted: "2",
  started: "3",
  review: "4",
  done: "5",
  canceled: "6",
};

function Buttons() {
  return (
    <SubSection title="Button" hint="default 28px · sm 24px · lg 32px">
      <Specimen label="variants: one monochrome primary per view">
        <Button>Create issue</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="outline">Filter</Button>
        <Button variant="ghost">Show done</Button>
        <Button variant="destructive">Delete issue</Button>
        <Button variant="link">Open context doc</Button>
      </Specimen>
      <Specimen label="sizes, icons, disabled">
        <Button size="lg" data-icon="inline-start">
          <PlusIcon />
          New issue
        </Button>
        <Button data-icon="inline-start">
          <PlusIcon />
          New issue
        </Button>
        <Button size="sm" variant="secondary" data-icon="inline-start">
          <SlidersHorizontalIcon />
          Display
        </Button>
        <Button size="xs" variant="ghost">
          Clear
        </Button>
        <Button size="icon" variant="ghost" aria-label="Copy link">
          <CopyIcon />
        </Button>
        <Button size="icon-sm" variant="outline" aria-label="Add sub-issue">
          <PlusIcon />
        </Button>
        <Button disabled>Saving…</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
      </Specimen>
    </SubSection>
  );
}

function Inputs() {
  const id = React.useId();
  return (
    <SubSection
      title="Input, field, textarea"
      hint="focus shifts the border; errors get border + icon + text"
    >
      <div className="border-border grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
          <Input id={`${id}-title`} placeholder="Issue title" />
          <FieldDescription>Keep it short; details go in the description.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-search`}>Search</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput id={`${id}-search`} placeholder="Filter by title" />
            <InputGroupAddon align="inline-end">
              <Keycap keys="/" />
            </InputGroupAddon>
          </InputGroup>
        </Field>
        <Field data-invalid>
          <FieldLabel htmlFor={`${id}-key`}>Project key</FieldLabel>
          <Input id={`${id}-key`} defaultValue="pan" aria-invalid />
          <FieldError>Use 2–10 capital letters or digits, starting with a letter.</FieldError>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-disabled`}>Email</FieldLabel>
          <Input id={`${id}-disabled`} defaultValue="kris@example.com" disabled />
          <FieldDescription>Invites are tied to this address.</FieldDescription>
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-description`}>Comment</FieldLabel>
          <Textarea id={`${id}-description`} placeholder="Leave a comment… (⌘↵ to send)" />
        </Field>
      </div>
    </SubSection>
  );
}

function BadgesAndAvatars() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <SubSection title="Badge" hint="counts and states, not categories">
        <Specimen>
          <Badge variant="outline">via MCP</Badge>
          <Badge variant="secondary">3</Badge>
          <Badge variant="outline">Owner</Badge>
          <Badge variant="solid">New</Badge>
          <Badge variant="secondary">Draft</Badge>
        </Specimen>
      </SubSection>
      <SubSection title="Avatar and stack" hint="16 / 20 / 24 / 32">
        <Specimen>
          <PersonAvatar person={PEOPLE[0]!} size="xs" />
          <PersonAvatar person={PEOPLE[0]!} size="sm" />
          <PersonAvatar person={PEOPLE[0]!} />
          <PersonAvatar person={PEOPLE[0]!} size="lg" />
          <span className="bg-border mx-1 h-6 w-px" />
          <AvatarStack people={PEOPLE} max={3} />
          <AvatarStack people={PEOPLE.slice(0, 2)} size="sm" />
        </Specimen>
      </SubSection>
      <SubSection title="Pantry avatar" hint="seeded by space key · 16 / 20 / 24 / 32 / 48">
        <Specimen>
          {PANTRY_SHAPE_NAMES.map((shape) => (
            <PantryAvatar key={shape} seed={shape} shape={shape} size="lg" />
          ))}
        </Specimen>
        <Specimen>
          <PantryAvatar seed="PAN" size="xs" />
          <PantryAvatar seed="PAN" size="sm" />
          <PantryAvatar seed="PAN" />
          <PantryAvatar seed="PAN" size="lg" />
          <PantryAvatar seed="PAN" size="xl" />
          <span className="bg-border mx-1 h-6 w-px" />
          <AvatarPickerDemo />
        </Specimen>
      </SubSection>
    </div>
  );
}

function AvatarPickerDemo() {
  const [avatar, setAvatar] = React.useState<PantryAvatarValue>(() => {
    const { shape, color, expression } = pickPantryAvatar("PAN");
    return { shape, color, expression };
  });
  return <PantryAvatarPicker value={avatar} onChange={setAvatar} seed="PAN" size="xl" />;
}

function TabsAndToggles() {
  const [display, setDisplay] = React.useState<"list" | "board">("list");
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <SubSection title="Tabs" hint="indicator glides on --ease-spring-morph">
        <div className="border-border flex flex-col gap-4 rounded-lg border p-4">
          <Tabs defaultValue="activity">
            <TabsList variant="line">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="comments">Comments</TabsTrigger>
              <TabsTrigger value="sub-issues">Sub-issues</TabsTrigger>
            </TabsList>
            <TabsContent value="activity" className="text-muted-foreground text-xs">
              Kris moved this to In Progress · 2m
            </TabsContent>
            <TabsContent value="comments" className="text-muted-foreground text-xs">
              2 comments
            </TabsContent>
            <TabsContent value="sub-issues" className="text-muted-foreground text-xs">
              3 sub-issues, 1 done
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="mine">
            <TabsList>
              <TabsTrigger value="mine">Assigned</TabsTrigger>
              <TabsTrigger value="created">Created</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </SubSection>
      <SubSection title="Segmented control and toggles" hint="single choice · multi-select toolbar">
        <div className="border-border flex flex-col items-start gap-4 rounded-lg border p-4">
          <SegmentedControl
            aria-label="Layout"
            value={display}
            onValueChange={setDisplay}
            options={[
              { value: "list", label: "List", icon: <ListIcon /> },
              { value: "board", label: "Board", icon: <KanbanIcon /> },
            ]}
          />
          <ToggleGroup defaultValue={["status"]} multiple aria-label="Show properties">
            <ToggleGroupItem value="status" aria-label="Status">
              <CircleDashedIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="assignee" aria-label="Assignee">
              <UserIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="labels" aria-label="Labels">
              <TagIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="due" aria-label="Due date">
              <CalendarIcon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </SubSection>
    </div>
  );
}

function Overlays() {
  const brand = useDesignBrand();
  const [status, setStatus] = React.useState<StatusCategory>("started");
  const [showDone, setShowDone] = React.useState(false);
  return (
    <SubSection
      title="Menus, popover, tooltip, dialog, sheet"
      hint="popups scale from their trigger; exits are faster"
    >
      <Specimen>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="secondary" data-icon="inline-start" />}>
            <StatusGlyph category={status} />
            {STATUS_CATEGORY_LABEL[status]}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Change status</DropdownMenuLabel>
              {STATUS_CATEGORIES.map((category) => (
                <DropdownMenuItem key={category} onClick={() => setStatus(category)}>
                  <StatusGlyph category={category} />
                  {STATUS_CATEGORY_LABEL[category]}
                  <DropdownMenuShortcut>{STATUS_KEYS[category]}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label="More actions" />}
          >
            <SettingsIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              <CopyIcon />
              Copy issue key
              <DropdownMenuShortcut>
                <Keycap keys="mod+." />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <PlusIcon />
              Add sub-issue
              <DropdownMenuShortcut>
                <Keycap keys="shift+c" />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowUpDownIcon />
                Priority
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {([1, 2, 3, 4, 0] as const).map((priority) => (
                  <DropdownMenuItem key={priority}>
                    <PriorityGlyph priority={priority} />
                    {["No priority", "Urgent", "High", "Medium", "Low"][priority]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuCheckboxItem checked={showDone} onCheckedChange={setShowDone}>
              Show done issues
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <TrashIcon />
              Delete issue…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover>
          <PopoverTrigger render={<Button variant="secondary" data-icon="inline-start" />}>
            <CalendarIcon />
            Due date
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <PopoverHeader>
              <PopoverTitle>Set due date</PopoverTitle>
              <PopoverDescription>Shown on the issue and in My issues.</PopoverDescription>
            </PopoverHeader>
            <Input type="date" defaultValue="2026-11-02" aria-label="Due date" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost">
                Clear
              </Button>
              <Button size="sm">Save date</Button>
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Assign to me" />}>
            <UserIcon />
          </TooltipTrigger>
          <TooltipContent>
            Assign to me <Keycap keys="i" />
          </TooltipContent>
        </Tooltip>

        <Dialog>
          <DialogTrigger render={<Button data-icon="inline-start" />}>
            <PlusIcon />
            New issue
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New issue</DialogTitle>
              <DialogDescription>
                In <IssueKey value={brand.defaultKey} className="text-foreground" /> · it gets the
                next number.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <Input placeholder="Issue title" aria-label="Issue title" autoFocus />
              <Textarea placeholder="Add a description…" aria-label="Description" />
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" data-icon="inline-start">
                  <StatusGlyph category="unstarted" />
                  Todo
                </Button>
                <Button size="sm" variant="outline" data-icon="inline-start">
                  <PriorityGlyph priority={0} />
                  Priority
                </Button>
                <Button size="sm" variant="outline" data-icon="inline-start">
                  <TagIcon />
                  Labels
                </Button>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button size="default">
                Create issue <Keycap keys="mod+enter" className="ml-1" />
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet>
          <SheetTrigger render={<Button variant="outline" />}>Open sheet</SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Workspace</SheetTitle>
              <SheetDescription>Below ~640px the sidebar becomes this sheet.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </Specimen>
    </SubSection>
  );
}

/** Right-click menu: the dropdown's parts, opened at the pointer (or Shift+F10 on the focus). */
function ContextMenuDemo() {
  const brand = useDesignBrand();
  const [status, setStatus] = React.useState<StatusCategory>("unstarted");
  return (
    <SubSection
      title="Context menu"
      hint="right-click, long-press or Shift+F10 · same items as the dropdown"
    >
      <Specimen>
        <ContextMenu>
          <ContextMenuTrigger
            tabIndex={0}
            className="border-border text-muted-foreground focus-visible:outline-ring flex h-24 w-80 items-center justify-center gap-2 rounded-lg border border-dashed text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <StatusGlyph category={status} />
            <IssueKey value={`${brand.defaultKey}-42`} />
            Right-click this issue
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            <ContextMenuGroup>
              <ContextMenuLabel>2 issues</ContextMenuLabel>
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <StatusGlyph category={status} />
                  Status
                  <ContextMenuShortcut>
                    <Keycap keys="s" />
                  </ContextMenuShortcut>
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                  {STATUS_CATEGORIES.map((category) => (
                    <ContextMenuItem key={category} onClick={() => setStatus(category)}>
                      <StatusGlyph category={category} />
                      {STATUS_CATEGORY_LABEL[category]}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuItem>
                <PlusIcon />
                Add sub-issue
                <ContextMenuShortcut>
                  <Keycap keys="shift+c" />
                </ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem>
                <CopyIcon />
                Copy link
              </ContextMenuItem>
            </ContextMenuGroup>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive">
              <TrashIcon />
              Delete 2 issues…
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Specimen>
    </SubSection>
  );
}

function WhenVisible({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}>
      {visible ? children : null}
    </div>
  );
}

function CommandDemo() {
  const brand = useDesignBrand();
  const [open, setOpen] = React.useState(false);
  const list = (
    <>
      <CommandInput placeholder="Search issues, projects and actions…" />
      <CommandList>
        <CommandEmpty>No results. Try an issue key like {brand.defaultKey}-42.</CommandEmpty>
        <CommandGroup heading="Issues">
          <CommandItem>
            <StatusGlyph category="started" />
            <IssueKey value={`${brand.defaultKey}-42`} />
            <span className="truncate">Sign-up guard rejects stale invites</span>
          </CommandItem>
          <CommandItem>
            <StatusGlyph category="review" />
            <IssueKey value={`${brand.defaultKey}-38`} />
            <span className="truncate">Design tokens for light and dark</span>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigation">
          <CommandItem>
            <InboxIcon />
            Go to My issues
            <CommandShortcut>
              <Keycap keys="g i" />
            </CommandShortcut>
          </CommandItem>
          <CommandItem>
            <FolderIcon />
            Go to project
            <CommandShortcut>
              <Keycap keys="g p" />
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem>
            <PlusIcon />
            Create issue
            <CommandShortcut>
              <Keycap keys="c" />
            </CommandShortcut>
          </CommandItem>
          <CommandItem>
            <LayersIcon />
            Create sub-issue
            <CommandShortcut>
              <Keycap keys="shift+c" />
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </>
  );
  return (
    <SubSection title="Command" hint="restyled cmdk; palette ranking + glide arrive in M3">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_auto]">
        {/* cmdk scrolls its selected row into view on mount; mount it only once visible so the page doesn't jump. */}
        <WhenVisible className="min-h-[23rem]">
          <Command className="shadow-overlay h-auto rounded-xl">{list}</Command>
        </WhenVisible>
        <div className="flex flex-col items-start gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)} data-icon="inline-end">
            Open palette <Keycap keys="mod+k" />
          </Button>
          <CommandDialog open={open} onOpenChange={setOpen}>
            <Command>{list}</Command>
          </CommandDialog>
        </div>
      </div>
    </SubSection>
  );
}

function Toasts() {
  const brand = useDesignBrand();
  return (
    <SubSection title="Toast" hint="sonner on the overlay surface; colour only in the icon">
      <Specimen>
        <Button
          variant="secondary"
          onClick={() =>
            toast.success(`${brand.defaultKey}-42 moved to In Review`, {
              description: "via MCP · Kris",
            })
          }
        >
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast(`Deleted ${brand.defaultKey}-17`, {
              action: { label: "Undo", onClick: () => undefined },
            })
          }
        >
          With action
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.error("Couldn’t save the description", {
              description: "You’re offline. We’ll retry when you’re back.",
            })
          }
        >
          Error
        </Button>
        <Button variant="secondary" onClick={() => toast.message("Invite link copied")}>
          Info
        </Button>
      </Specimen>
    </SubSection>
  );
}

function Keycaps() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <SubSection title="Keycap" hint="tinykeys notation; ⌘ on Mac, Ctrl elsewhere">
        <Specimen className="text-muted-foreground gap-x-5 gap-y-3 text-xs">
          {[
            ["mod+k", "Command palette"],
            ["c", "New issue"],
            ["shift+c", "New sub-issue"],
            ["g i", "My issues"],
            ["mod+enter", "Submit"],
            ["?", "Shortcut help"],
          ].map(([keys, label]) => (
            <span key={keys} className="inline-flex items-center gap-2">
              <Keycap keys={keys!} />
              {label}
            </span>
          ))}
        </Specimen>
      </SubSection>
      <SubSection title="Skeleton" hint="holds the shape while loading">
        <Specimen className="flex-col items-stretch gap-2">
          {[0.7, 0.5, 0.62].map((width, index) => (
            <div key={index} className="flex h-6 items-center gap-3">
              <Skeleton className="size-3.5 rounded-full" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3" style={{ width: `${width * 100}%` }} />
            </div>
          ))}
        </Specimen>
      </SubSection>
    </div>
  );
}

function SidebarDemo() {
  const brand = useDesignBrand();
  const [active, setActive] = React.useState("my-issues");
  const projects = [
    { id: "pan", name: brand.name, color: "violet" },
    { id: "site", name: "Website", color: "blue" },
    { id: "ops", name: "Ops", color: "green" },
  ];
  return (
    <SubSection title="Sidebar" hint="collapses to a 56px rail on --ease-spring-smooth">
      {/* transform makes this frame the containing block for the sidebar's fixed positioning */}
      <div className="border-border h-[26rem] [transform:translateZ(0)] overflow-hidden rounded-xl border">
        <SidebarProvider className="h-full min-h-0">
          <Sidebar collapsible="icon" className="h-full">
            <SidebarHeader>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton size="lg" tooltip={`${brand.name} workspace`}>
                    <span className="bg-primary font-display text-primary-foreground flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold">
                      {brand.name[0]}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="text-foreground truncate text-sm font-medium">Home</span>
                      <span className="text-2xs text-muted-foreground truncate">2 members</span>
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Search">
                    <SearchIcon />
                    <span>Search</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>
                    <Keycap keys="mod+k" />
                  </SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={active === "my-issues"}
                      onClick={() => setActive("my-issues")}
                      tooltip="My issues"
                    >
                      <InboxIcon />
                      <span>My issues</span>
                    </SidebarMenuButton>
                    <SidebarMenuBadge>7</SidebarMenuBadge>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>Projects</SidebarGroupLabel>
                <SidebarGroupAction aria-label="New project">
                  <PlusIcon />
                </SidebarGroupAction>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {projects.map((project) => (
                      <SidebarMenuItem key={project.id}>
                        <SidebarMenuButton
                          isActive={active === project.id}
                          onClick={() => setActive(project.id)}
                          tooltip={project.name}
                        >
                          <span className="flex size-4 items-center justify-center">
                            <span
                              className="size-2 rounded-full"
                              style={{ background: `var(--label-${project.color})` }}
                            />
                          </span>
                          <span>{project.name}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings">
                    <SettingsIcon />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarFooter>
          </Sidebar>
          <SidebarInset className="min-h-0">
            <header className="border-border flex h-11 shrink-0 items-center gap-2 border-b px-3">
              <SidebarTrigger />
              <span className="text-foreground text-sm font-medium">My issues</span>
              <Badge variant="secondary">7</Badge>
            </header>
            <div className="text-muted-foreground flex flex-1 flex-col gap-2 p-4 text-sm">
              <p>
                Click the panel icon to fold the sidebar to its rail; hover a rail icon for its
                tooltip.
              </p>
              <p className="text-muted-foreground text-xs">
                In the app, <Keycap keys="[" /> folds it through the shortcut registry (M3).
              </p>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </div>
    </SubSection>
  );
}

export function ComponentsSection() {
  return (
    <Section
      id="components"
      title="Components"
      description="shadcn/ui on Base UI, generated with the base-mira style and restyled to the tokens above. The source lives in packages/ui/src/components and is ours to change."
    >
      <Buttons />
      <Inputs />
      <BadgesAndAvatars />
      <TabsAndToggles />
      <Overlays />
      <ContextMenuDemo />
      <CommandDemo />
      <Toasts />
      <Keycaps />
      <SidebarDemo />
    </Section>
  );
}
