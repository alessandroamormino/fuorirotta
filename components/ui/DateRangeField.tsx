"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { it } from "date-fns/locale";
import {
	format,
	addMonths,
	subMonths,
	startOfMonth,
	endOfMonth,
	eachDayOfInterval,
	isSameMonth,
	isSameDay,
	isToday,
	startOfWeek,
	endOfWeek,
} from "date-fns";

interface DateRangeFieldProps {
	dateFrom: Date | null;
	dateTo: Date | null;
	onChange: (range: { dateFrom: Date | null; dateTo: Date | null }) => void;
	variant: "desktop" | "mobile";
}

export default function DateRangeField({
	dateFrom,
	dateTo,
	onChange,
	variant,
}: DateRangeFieldProps) {
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const [hoveredDate, setHoveredDate] = useState<Date | null>(null);

	const handleDateSelect = (date: Date) => {
		if (!dateFrom || (dateFrom && dateTo)) {
			onChange({ dateFrom: date, dateTo: null });
		} else {
			if (date < dateFrom) {
				onChange({ dateFrom: date, dateTo: dateFrom });
			} else {
				onChange({ dateFrom, dateTo: date });
			}
		}
	};

	const isDateInRange = (date: Date) => {
		if (!dateFrom) return false;
		if (!dateTo && !hoveredDate) return isSameDay(date, dateFrom);
		const endDate = dateTo || hoveredDate;
		if (!endDate) return isSameDay(date, dateFrom);
		return date >= dateFrom && date <= endDate;
	};

	const isDateRangeStart = (date: Date) =>
		!!(dateFrom && isSameDay(date, dateFrom));
	const isDateRangeEnd = (date: Date) => !!(dateTo && isSameDay(date, dateTo));

	const getDaysInMonth = (month: Date) => {
		const start = startOfWeek(startOfMonth(month), { locale: it });
		const end = endOfWeek(endOfMonth(month), { locale: it });
		return eachDayOfInterval({ start, end });
	};

	const renderCalendarGrid = (month: Date) => {
		const days = getDaysInMonth(month);
		return (
			<div className="grid grid-cols-7 gap-0.5">
				{["L", "M", "M", "G", "V", "S", "D"].map((day, i) => (
					<div
						key={i}
						className="text-center text-[10px] font-semibold text-muted-foreground-faint py-2"
					>
						{day}
					</div>
				))}
				{days.map((date, i) => {
					const inRange = isDateInRange(date);
					const isStart = isDateRangeStart(date);
					const isEnd = isDateRangeEnd(date);
					const isCurrentMonth = isSameMonth(date, month);
					const isPast = date < new Date() && !isToday(date);

					return (
						<motion.button
							key={i}
							whileHover={isCurrentMonth && !isPast ? { scale: 1.1 } : {}}
							onClick={() =>
								isCurrentMonth && !isPast && handleDateSelect(date)
							}
							onMouseEnter={() =>
								isCurrentMonth && !isPast && setHoveredDate(date)
							}
							onMouseLeave={() => setHoveredDate(null)}
							disabled={!isCurrentMonth || isPast}
							className={`
                aspect-square flex items-center justify-center text-sm rounded-full transition-all
                ${!isCurrentMonth ? "text-border" : ""}
                ${isPast ? "text-disabled-foreground cursor-not-allowed" : ""}
                ${isStart || isEnd ? "bg-gradient-to-r from-primary to-accent text-primary-foreground font-bold" : ""}
                ${inRange && !isStart && !isEnd ? "bg-primary/10" : ""}
                ${!inRange && !isPast && isCurrentMonth ? "hover:bg-muted-strong" : ""}
                ${isToday(date) && !isStart && !isEnd ? "border-2 border-primary" : ""}
              `}
						>
							{format(date, "d")}
						</motion.button>
					);
				})}
			</div>
		);
	};

	if (variant === "mobile") {
		return (
			<div className="flex-1 overflow-hidden mx-4 mb-32 bg-surface rounded-2xl shadow-sm flex flex-col">
				{/* Header fisso "Quando?" */}
				<div className="px-5 pt-5 pb-3 flex-shrink-0">
					<h2 className="text-2xl font-bold text-foreground">Quando?</h2>
					{/* Intestazione giorni settimana fissa */}
					<div className="grid grid-cols-7 gap-0.5 mt-4">
						{["L", "M", "M", "G", "V", "S", "D"].map((day, i) => (
							<div
								key={i}
								className="text-center text-[10px] font-semibold text-muted-foreground-faint py-1"
							>
								{day}
							</div>
						))}
					</div>
				</div>

				{/* Mesi scrollabili */}
				<div className="flex-1 overflow-y-auto px-5 pb-5">
					{[0, 1, 2].map((offset) => {
						const month = addMonths(currentMonth, offset);
						const days = getDaysInMonth(month);
						return (
							<div key={offset} className="mb-6">
								<h3 className="font-bold text-foreground text-base mb-3">
									{format(month, "MMMM yyyy", { locale: it })}
								</h3>
								<div className="grid grid-cols-7 gap-0.5">
									{days.map((date, i) => {
										const inRange = isDateInRange(date);
										const isStart = isDateRangeStart(date);
										const isEnd = isDateRangeEnd(date);
										const isCurrentMonth = isSameMonth(date, month);
										const isPast = date < new Date() && !isToday(date);
										return (
											<motion.button
												key={i}
												whileHover={
													isCurrentMonth && !isPast ? { scale: 1.1 } : {}
												}
												onClick={() =>
													isCurrentMonth && !isPast && handleDateSelect(date)
												}
												onMouseEnter={() =>
													isCurrentMonth && !isPast && setHoveredDate(date)
												}
												onMouseLeave={() => setHoveredDate(null)}
												disabled={!isCurrentMonth || isPast}
												className={`
													aspect-square flex items-center justify-center text-sm rounded-full transition-all
													${!isCurrentMonth ? "text-border" : ""}
													${isPast ? "text-disabled-foreground cursor-not-allowed" : ""}
													${isStart || isEnd ? "bg-gradient-to-r from-primary to-accent text-primary-foreground font-bold" : ""}
													${inRange && !isStart && !isEnd ? "bg-primary/10" : ""}
													${!inRange && !isPast && isCurrentMonth ? "hover:bg-muted-strong" : ""}
													${isToday(date) && !isStart && !isEnd ? "border-2 border-primary" : ""}
												`}
											>
												{format(date, "d")}
											</motion.button>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		);
	}

	return (
		<div className="flex gap-8">
			{/* Month 1 */}
			<div className="flex-1">
				<div className="flex items-center justify-between mb-4">
					<button
						onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
						className="p-2 hover:bg-muted-strong rounded-full transition-colors"
					>
						<ChevronLeft className="w-5 h-5" />
					</button>
					<h3 className="font-bold text-foreground text-base">
						{format(currentMonth, "MMMM yyyy", { locale: it })}
					</h3>
					<div className="w-9" />
				</div>
				{renderCalendarGrid(currentMonth)}
			</div>

			{/* Month 2 */}
			<div className="flex-1">
				<div className="flex items-center justify-between mb-4">
					<div className="w-9" />
					<h3 className="font-bold text-foreground text-base">
						{format(addMonths(currentMonth, 1), "MMMM yyyy", { locale: it })}
					</h3>
					<button
						onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
						className="p-2 hover:bg-muted-strong rounded-full transition-colors"
					>
						<ChevronRight className="w-5 h-5" />
					</button>
				</div>
				{renderCalendarGrid(addMonths(currentMonth, 1))}
			</div>
		</div>
	);
}
