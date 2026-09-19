import { View, type ViewStyle } from "react-native";

interface MockIconProps {
  readonly accessible?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

function MockIcon({ accessible, style, testID }: MockIconProps) {
  return <View accessible={accessible} style={style} testID={testID} />;
}

export default MockIcon;

export const ArrowDown = MockIcon;
export const ArrowRight = MockIcon;
export const Bell = MockIcon;
export const BookOpen = MockIcon;
export const CalendarDays = MockIcon;
export const Check = MockIcon;
export const ClipboardList = MockIcon;
export const ChevronLeft = MockIcon;
export const ChevronRight = MockIcon;
export const CircleAlert = MockIcon;
export const CircleCheck = MockIcon;
export const CircleHelp = MockIcon;
export const CircleX = MockIcon;
export const Clock3 = MockIcon;
export const FileText = MockIcon;
export const GraduationCap = MockIcon;
export const House = MockIcon;
export const Info = MockIcon;
export const MapPin = MockIcon;
export const Menu = MockIcon;
export const MessageCircle = MockIcon;
export const Minus = MockIcon;
export const MoreVertical = MockIcon;
export const Plus = MockIcon;
export const RefreshCw = MockIcon;
export const Send = MockIcon;
export const Settings = MockIcon;
export const UserRound = MockIcon;
export const UsersRound = MockIcon;
export const Video = MockIcon;
export const X = MockIcon;
