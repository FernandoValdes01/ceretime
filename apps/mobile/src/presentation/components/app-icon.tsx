import ArrowDown from "lucide-react-native/icons/arrow-down";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import Bell from "lucide-react-native/icons/bell";
import BookOpen from "lucide-react-native/icons/book-open";
import CalendarDays from "lucide-react-native/icons/calendar-days";
import Check from "lucide-react-native/icons/check";
import ClipboardList from "lucide-react-native/icons/clipboard-list";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleHelp from "lucide-react-native/icons/circle-question-mark";
import CircleX from "lucide-react-native/icons/circle-x";
import Clock3 from "lucide-react-native/icons/clock-3";
import FileText from "lucide-react-native/icons/file-text";
import GraduationCap from "lucide-react-native/icons/graduation-cap";
import House from "lucide-react-native/icons/house";
import Info from "lucide-react-native/icons/info";
import LogOut from "lucide-react-native/icons/log-out";
import MapPin from "lucide-react-native/icons/map-pin";
import Menu from "lucide-react-native/icons/menu";
import MessageCircle from "lucide-react-native/icons/message-circle";
import MoreVertical from "lucide-react-native/icons/ellipsis-vertical";
import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Send from "lucide-react-native/icons/send";
import Settings from "lucide-react-native/icons/settings";
import UserRound from "lucide-react-native/icons/user-round";
import UsersRound from "lucide-react-native/icons/users-round";
import Video from "lucide-react-native/icons/video";
import X from "lucide-react-native/icons/x";
import type { LucideIcon, LucideProps } from "lucide-react-native";

const ICONS = {
  alert: CircleAlert,
  arrowDown: ArrowDown,
  arrowRight: ArrowRight,
  bell: Bell,
  bookOpen: BookOpen,
  calendar: CalendarDays,
  check: Check,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  circleCheck: CircleCheck,
  circleHelp: CircleHelp,
  circleX: CircleX,
  clock: Clock3,
  clipboardList: ClipboardList,
  fileText: FileText,
  graduationCap: GraduationCap,
  house: House,
  info: Info,
  logOut: LogOut,
  mapPin: MapPin,
  menu: Menu,
  messageCircle: MessageCircle,
  minus: Minus,
  moreVertical: MoreVertical,
  plus: Plus,
  refresh: RefreshCw,
  send: Send,
  settings: Settings,
  user: UserRound,
  users: UsersRound,
  video: Video,
  x: X,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof ICONS;

export interface AppIconProps extends Omit<LucideProps, "color" | "size"> {
  readonly name: AppIconName;
  readonly color?: string;
  readonly size?: number;
}

export function AppIcon({ name, color = "#42565B", size = 20, ...props }: AppIconProps) {
  const Icon = ICONS[name];
  return <Icon color={color} size={size} {...props} />;
}
