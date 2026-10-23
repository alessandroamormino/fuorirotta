import Image from "next/image";
import Link from "next/link";
import AccountButton from "@/components/account/AccountButton";
import SavedNavButton from "@/components/saved/SavedNavButton";
import ThemeToggle from "@/components/ui/ThemeToggle";

/**
 * Testata minima per le pagine senza la navbar di ricerca (/account, /accedi,
 * /privacy, /cookie): logo, cuore dei salvati, icona dell'account e tema, niente macchina di
 * ricerca. E' il secondo montaggio legittimo di ThemeToggle (21-UI-SPEC
 * Superficie 8); check:navbar ne ammette esattamente due. Non e' sticky.
 */
export default function SiteHeader() {
	return (
		<header className="mx-auto flex w-full max-w-[1760px] items-center justify-between px-4 py-3">
			<Link href="/" aria-label="Fuorirotta - pagina iniziale" className="flex items-center space-x-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
				<Image
					src="/images/logo.svg"
					alt=""
					width={40}
					height={40}
					className="h-8 w-8 sm:h-10 sm:w-10"
					priority
				/>
				<span className="text-2xl font-bold text-primary max-[359px]:hidden">Fuorirotta</span>
			</Link>
			<div className="flex flex-none items-center gap-2">
				<SavedNavButton />
				<AccountButton />
				<ThemeToggle className="flex-none flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-surface border border-border text-foreground shadow-sm hover:border-primary/50 transition-colors" />
			</div>
		</header>
	);
}
