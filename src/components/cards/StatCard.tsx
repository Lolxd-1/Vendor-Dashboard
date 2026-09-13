interface StatCardProps {
    title: string;
    value: string | number;
    icon?: React.ReactNode;
    trend?: string;
}

export const StatCard = ({ title, value, }: StatCardProps) => (
    <div className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-6 rounded-2xl shadow-sm dark:shadow-lg hover:shadow-md dark:hover:shadow-emerald-500/5 transition-all duration-300">
        <p className="text-slate-500 dark:text-zinc-500 text-sm font-medium uppercase tracking-wider">{title}</p>
        <div className="flex items-end justify-between mt-2">
            <h3 className="text-3xl font-bold text-slate-900 dark:text-white">{value}</h3>

        </div>
    </div>
);
