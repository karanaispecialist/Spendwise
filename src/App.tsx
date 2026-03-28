import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  getDocFromServer,
  updateDoc,
  getDocs
} from 'firebase/firestore';
import { auth, db, logOut, signInAnon, signInCustom } from './firebase';
import { 
  Account, 
  Expense, 
  Budget, 
  RecurringExpense, 
  CATEGORIES, 
  ACCOUNT_TYPES,
  BUDGET_PERIODS,
  RECURRING_FREQUENCIES
} from './types';
import { 
  LayoutDashboard, 
  PlusCircle, 
  Wallet, 
  History, 
  LogOut, 
  LogIn,
  CreditCard,
  Smartphone,
  Banknote,
  PieChart as PieChartIcon,
  TrendingUp,
  Trash2,
  ChevronRight,
  Plus,
  X,
  Bell,
  Calendar,
  Repeat,
  AlertTriangle,
  CheckCircle2,
  Search
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  parseISO, 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval, 
  startOfWeek, 
  endOfWeek,
  addDays,
  addWeeks,
  addMonths,
  addYears,
  isBefore,
  isAfter,
  isSameDay,
  differenceInDays
} from 'date-fns';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendAuth, setBackendAuth] = useState<{authenticated: boolean, user?: {user: string, stableUserId: string, firebaseToken?: string}} | null>(null);
  const [loginError, setLoginError] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'expenses' | 'accounts' | 'budgets' | 'recurring'>('dashboard');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showAddBudget, setShowAddBudget] = useState(false);
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [notifications, setNotifications] = useState<{id: string, message: string, type: 'info' | 'warning' | 'success'}[]>([]);
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterMonth, setFilterMonth] = useState<string>('All');
  const [filterYear, setFilterYear] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/me');
        if (!res.ok) {
          console.error('Auth check failed with status:', res.status);
          setBackendAuth({ authenticated: false });
          return;
        }
        const data = await res.json();
        setBackendAuth(data);
        if (data.authenticated && !auth.currentUser) {
          try {
            if (data.user?.firebaseToken) {
              await signInCustom(data.user.firebaseToken);
              console.log('Signed in with custom token');
            } else {
              await signInAnon();
            }
          } catch (authErr: any) {
            console.error('Firebase Anon Auth Error in checkAuth:', authErr);
            if (authErr.code === 'auth/admin-restricted-operation') {
              setLoginError('Anonymous Auth is disabled. Please enable it in Firebase Console.');
              setBackendAuth({ authenticated: false });
            }
          }
        }
      } catch (err) {
        console.error('Check auth network error:', err);
        setBackendAuth({ authenticated: false });
      }
    };
    checkAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });

    // Connection test
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !backendAuth?.user?.stableUserId) return;

    const stableUid = backendAuth.user.stableUserId;

    const qAccounts = query(collection(db, 'accounts'), where('userId', '==', stableUid));
    const unsubAccounts = onSnapshot(qAccounts, (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account)));
    });

    const qExpenses = query(collection(db, 'expenses'), where('userId', '==', stableUid));
    const unsubExpenses = onSnapshot(qExpenses, (snapshot) => {
      const exps = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense));
      setExpenses(exps.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    });

    const qBudgets = query(collection(db, 'budgets'), where('userId', '==', stableUid));
    const unsubBudgets = onSnapshot(qBudgets, (snapshot) => {
      setBudgets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Budget)));
    });

    const qRecurring = query(collection(db, 'recurring_expenses'), where('userId', '==', stableUid));
    const unsubRecurring = onSnapshot(qRecurring, (snapshot) => {
      setRecurringExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RecurringExpense)));
    });

    return () => {
      unsubAccounts();
      unsubExpenses();
      unsubBudgets();
      unsubRecurring();
    };
  }, [user, backendAuth]);

  // Process Recurring Expenses
  useEffect(() => {
    if (!user || recurringExpenses.length === 0) return;

    const processRecurring = async () => {
      const now = new Date();
      let loggedAny = false;

      for (const rec of recurringExpenses) {
        let lastDate = rec.lastLoggedDate ? parseISO(rec.lastLoggedDate) : parseISO(rec.startDate);
        let nextDate = lastDate;

        // Calculate next due date
        switch (rec.frequency) {
          case 'Daily': nextDate = addDays(lastDate, 1); break;
          case 'Weekly': nextDate = addWeeks(lastDate, 1); break;
          case 'Monthly': nextDate = addMonths(lastDate, 1); break;
          case 'Yearly': nextDate = addYears(lastDate, 1); break;
        }

        // Check if due and not past end date
        if (isBefore(nextDate, now) || isSameDay(nextDate, now)) {
          if (rec.endDate && isAfter(nextDate, parseISO(rec.endDate))) continue;

          try {
            // Log the expense
            await addDoc(collection(db, 'expenses'), {
              amount: rec.amount,
              category: rec.category,
              paymentMethodId: rec.paymentMethodId,
              paymentMethodName: rec.paymentMethodName,
              description: `[Recurring] ${rec.description}`,
              date: nextDate.toISOString(),
              userId: user.uid,
              isRecurring: true,
              recurringId: rec.id
            });

            // Update last logged date
            await updateDoc(doc(db, 'recurring_expenses', rec.id!), {
              lastLoggedDate: nextDate.toISOString()
            });
            
            loggedAny = true;
          } catch (err) {
            console.error("Error logging recurring expense:", err);
          }
        }
      }

      if (loggedAny) {
        addNotification("Some recurring expenses were automatically logged.", "success");
      }
    };

    processRecurring();
  }, [recurringExpenses, user]);

  // Budget Notifications
  useEffect(() => {
    if (!user || budgets.length === 0 || expenses.length === 0) return;

    budgets.forEach(budget => {
      const now = new Date();
      const interval = budget.period === 'Monthly' 
        ? { start: startOfMonth(now), end: endOfMonth(now) }
        : { start: startOfWeek(now), end: endOfWeek(now) };

      const spent = expenses
        .filter(exp => exp.category === budget.category && isWithinInterval(parseISO(exp.date), interval))
        .reduce((sum, exp) => sum + exp.amount, 0);

      if (spent >= budget.amount) {
        addNotification(`Budget exceeded for ${budget.category}! (Spent: ₹${spent}, Budget: ₹${budget.amount})`, "warning");
      } else if (spent >= budget.amount * 0.8) {
        addNotification(`Approaching budget limit for ${budget.category} (80% reached)`, "info");
      }
    });
  }, [budgets, expenses, user]);

  const addNotification = (message: string, type: 'info' | 'warning' | 'success') => {
    const id = Math.random().toString(36).substr(2, 9);
    setNotifications(prev => {
      // Avoid duplicate messages
      if (prev.some(n => n.message === message)) return prev;
      return [...prev, { id, message, type }];
    });
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  };

  const handleAddAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !backendAuth?.user?.stableUserId) return;
    const stableUid = backendAuth.user.stableUserId;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const type = formData.get('type') as any;
    const balance = parseFloat(formData.get('balance') as string) || 0;

    try {
      await addDoc(collection(db, 'accounts'), {
        name,
        type,
        balance,
        userId: stableUid
      });
      setShowAddAccount(false);
    } catch (err) {
      console.error("Error adding account:", err);
    }
  };

  const handleAddExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !backendAuth?.user?.stableUserId) return;
    const stableUid = backendAuth.user.stableUserId;
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);
    const category = formData.get('category') as string;
    const paymentMethodId = formData.get('paymentMethodId') as string;
    const description = formData.get('description') as string;
    const date = formData.get('date') as string;

    const account = accounts.find(a => a.id === paymentMethodId);

    try {
      await addDoc(collection(db, 'expenses'), {
        amount,
        category,
        paymentMethodId,
        paymentMethodName: account?.name || 'Unknown',
        description,
        date: date || new Date().toISOString(),
        userId: stableUid
      });
      setShowAddExpense(false);
    } catch (err) {
      console.error("Error adding expense:", err);
    }
  };

  const handleAddBudget = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !backendAuth?.user?.stableUserId) return;
    const stableUid = backendAuth.user.stableUserId;
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);
    const category = formData.get('category') as string;
    const period = formData.get('period') as any;

    try {
      await addDoc(collection(db, 'budgets'), {
        amount,
        category,
        period,
        userId: stableUid
      });
      setShowAddBudget(false);
      addNotification(`Budget for ${category} created successfully!`, "success");
    } catch (err) {
      console.error("Error adding budget:", err);
    }
  };

  const handleAddRecurring = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || !backendAuth?.user?.stableUserId) return;
    const stableUid = backendAuth.user.stableUserId;
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);
    const category = formData.get('category') as string;
    const paymentMethodId = formData.get('paymentMethodId') as string;
    const description = formData.get('description') as string;
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;
    const frequency = formData.get('frequency') as any;

    const account = accounts.find(a => a.id === paymentMethodId);

    try {
      await addDoc(collection(db, 'recurring_expenses'), {
        amount,
        category,
        paymentMethodId,
        paymentMethodName: account?.name || 'Unknown',
        description,
        startDate,
        endDate: endDate || null,
        frequency,
        userId: stableUid,
        lastLoggedDate: null
      });
      setShowAddRecurring(false);
      addNotification(`Recurring expense for ${category} set up!`, "success");
    } catch (err) {
      console.error("Error adding recurring expense:", err);
    }
  };

  const deleteExpense = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (err) {
      console.error("Error deleting expense:", err);
    }
  };

  const filteredExpenses = expenses.filter(exp => {
    const categoryMatch = filterCategory === 'All' || exp.category === filterCategory;
    const date = parseISO(exp.date);
    const monthMatch = filterMonth === 'All' || format(date, 'MM') === filterMonth;
    const yearMatch = filterYear === 'All' || format(date, 'yyyy') === filterYear;
    const searchMatch = searchQuery === '' || 
      exp.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      exp.paymentMethodName.toLowerCase().includes(searchQuery.toLowerCase());
    return categoryMatch && monthMatch && yearMatch && searchMatch;
  });

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoginError('');
    const formData = new FormData(e.currentTarget);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = `Server error: ${res.status}`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // If not JSON, use the status code
          console.error('Non-JSON error response:', errorText);
        }
        setLoginError(errorMessage);
        return;
      }

      const data = await res.json();
      if (data.success) {
        setBackendAuth({ authenticated: true, user: { user: username, stableUserId: data.stableUserId, firebaseToken: data.firebaseToken } });
        try {
          if (data.firebaseToken) {
            await signInCustom(data.firebaseToken);
          } else {
            await signInAnon();
          }
        } catch (authErr: any) {
          console.error('Firebase Anon Auth Error:', authErr);
          if (authErr.code === 'auth/admin-restricted-operation') {
            setLoginError('Anonymous Auth is disabled. Please enable it in Firebase Console (Authentication > Sign-in method).');
            setBackendAuth({ authenticated: false });
          } else {
            setLoginError('Firebase Auth failed. Please check your configuration.');
          }
        }
      } else {
        setLoginError(data.message || 'Login failed');
      }
    } catch (err) {
      console.error('Login fetch error:', err);
      setLoginError('Network error or server is down. Please try again.');
    }
  };

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setBackendAuth({ authenticated: false });
    await logOut();
  };

  if (loading || backendAuth === null) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  if (!backendAuth.authenticated) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl border border-zinc-100"
        >
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <TrendingUp className="text-white w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 mb-2 text-center">SpendWise</h1>
          <p className="text-zinc-500 mb-8 text-center">Login with your credentials</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-bold text-zinc-900">Username</label>
              <input required name="username" type="text" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="Enter username" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-bold text-zinc-900">Password</label>
              <input required name="password" type="password" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="Enter password" />
            </div>
            {loginError && <p className="text-red-600 text-sm font-medium">{loginError}</p>}
            <button 
              type="submit"
              className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 hover:bg-zinc-800 transition-colors"
            >
              <LogIn size={20} />
              Sign In
            </button>
          </form>
          
          <div className="mt-8 p-4 bg-blue-50 rounded-2xl border border-blue-100">
            <p className="text-xs text-blue-800 leading-relaxed">
              <strong>Note:</strong> Ensure you've enabled <strong>Anonymous Authentication</strong> in the Firebase Console (Authentication &gt; Sign-in method).
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-zinc-900"></div>
      </div>
    );
  }

  const totalSpent = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  const monthlySpent = filteredExpenses
    .filter(exp => {
      const expDate = parseISO(exp.date);
      return isWithinInterval(expDate, { start: startOfMonth(new Date()), end: endOfMonth(new Date()) });
    })
    .reduce((sum, exp) => sum + exp.amount, 0);

  const categoryData = CATEGORIES.map(cat => ({
    name: cat,
    value: filteredExpenses.filter(exp => exp.category === cat).reduce((sum, exp) => sum + exp.amount, 0)
  })).filter(d => d.value > 0);

  const accountData = accounts.map(acc => ({
    name: acc.name,
    value: filteredExpenses.filter(exp => exp.paymentMethodId === acc.id).reduce((sum, exp) => sum + exp.amount, 0)
  })).filter(d => d.value > 0);

  // Generate options for filters
  const yearOptions = Array.from({ length: 5 }, (_, i) => {
    return (new Date().getFullYear() - i).toString();
  });

  const monthOptions = [
    { label: 'January', value: '01' },
    { label: 'February', value: '02' },
    { label: 'March', value: '03' },
    { label: 'April', value: '04' },
    { label: 'May', value: '05' },
    { label: 'June', value: '06' },
    { label: 'July', value: '07' },
    { label: 'August', value: '08' },
    { label: 'September', value: '09' },
    { label: 'October', value: '10' },
    { label: 'November', value: '11' },
    { label: 'December', value: '12' },
  ];

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col md:flex-row">
      {/* Notifications */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {notifications.map(n => (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className={`p-4 rounded-2xl shadow-xl border flex items-center gap-3 pointer-events-auto min-w-[300px] ${
                n.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' :
                n.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' :
                'bg-blue-50 border-blue-200 text-blue-900'
              }`}
            >
              {n.type === 'warning' && <AlertTriangle size={20} />}
              {n.type === 'success' && <CheckCircle2 size={20} />}
              {n.type === 'info' && <Bell size={20} />}
              <p className="text-sm font-medium">{n.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Sidebar */}
      <nav className="w-full md:w-64 bg-white border-b md:border-r border-zinc-200 p-4 flex flex-col gap-2">
        <div className="flex items-center gap-3 px-2 py-4 mb-4">
          <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center">
            <TrendingUp className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-bold text-zinc-900">SpendWise</span>
        </div>
        
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20} />} label="Dashboard" />
        <NavButton active={activeTab === 'expenses'} onClick={() => setActiveTab('expenses')} icon={<History size={20} />} label="Expenses" />
        <NavButton active={activeTab === 'accounts'} onClick={() => setActiveTab('accounts')} icon={<Wallet size={20} />} label="Accounts" />
        <NavButton active={activeTab === 'budgets'} onClick={() => setActiveTab('budgets')} icon={<Bell size={20} />} label="Budgets" />
        <NavButton active={activeTab === 'recurring'} onClick={() => setActiveTab('recurring')} icon={<Repeat size={20} />} label="Recurring" />
        
        <div className="mt-auto pt-4 border-t border-zinc-100">
          <div className="flex items-center gap-3 px-2 py-3 mb-2">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-900 truncate">{user.displayName}</p>
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 text-zinc-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
          >
            <LogOut size={20} />
            <span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 p-4 md:p-8 overflow-y-auto">
        <header className="flex items-center justify-between mb-8">
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center">
            <div>
              <h2 className="text-2xl font-bold text-zinc-900">
                {activeTab === 'dashboard' && 'Financial Overview'}
                {activeTab === 'expenses' && 'Transaction History'}
                {activeTab === 'accounts' && 'Payment Methods'}
                {activeTab === 'budgets' && 'Budget Planning'}
                {activeTab === 'recurring' && 'Recurring Expenses'}
              </h2>
              <p className="text-zinc-500">
                {activeTab === 'dashboard' && 'Your spending habits at a glance'}
                {activeTab === 'expenses' && 'Keep track of every penny'}
                {activeTab === 'accounts' && 'Manage your cards and wallets'}
                {activeTab === 'budgets' && 'Control your spending by category'}
                {activeTab === 'recurring' && 'Automate your regular bills'}
              </p>
            </div>

            {(activeTab === 'dashboard' || activeTab === 'expenses') && (
              <div className="flex flex-wrap gap-2 mt-2 md:mt-0 md:ml-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input 
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search expenses..."
                    className="pl-9 pr-4 py-2 bg-white border border-zinc-200 text-sm rounded-xl outline-none focus:ring-2 focus:ring-zinc-900 w-full md:w-48"
                  />
                </div>
                <select 
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-white border border-zinc-200 text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  <option value="All">All Categories</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <select 
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="bg-white border border-zinc-200 text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  <option value="All">All Months</option>
                  {monthOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <select 
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="bg-white border border-zinc-200 text-sm rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-zinc-900"
                >
                  <option value="All">All Years</option>
                  {yearOptions.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
                {(filterCategory !== 'All' || filterMonth !== 'All' || filterYear !== 'All' || searchQuery !== '') && (
                  <button 
                    onClick={() => { 
                      setFilterCategory('All'); 
                      setFilterMonth('All'); 
                      setFilterYear('All');
                      setSearchQuery('');
                    }}
                    className="text-xs font-bold text-zinc-400 hover:text-zinc-900 px-2"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-3">
            {activeTab === 'budgets' && (
              <button 
                onClick={() => setShowAddBudget(true)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-all font-medium shadow-lg shadow-zinc-200"
              >
                <PlusCircle size={18} />
                Set Budget
              </button>
            )}
            {activeTab === 'recurring' && (
              <button 
                onClick={() => setShowAddRecurring(true)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-all font-medium shadow-lg shadow-zinc-200"
              >
                <PlusCircle size={18} />
                Add Recurring
              </button>
            )}
            {activeTab !== 'budgets' && activeTab !== 'recurring' && (
              <>
                <button 
                  onClick={() => setShowAddAccount(true)}
                  className="hidden md:flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 text-zinc-700 rounded-xl hover:bg-zinc-50 transition-all font-medium"
                >
                  <Plus size={18} />
                  Add Account
                </button>
                <button 
                  onClick={() => setShowAddExpense(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-xl hover:bg-zinc-800 transition-all font-medium shadow-lg shadow-zinc-200"
                >
                  <PlusCircle size={18} />
                  New Expense
                </button>
              </>
            )}
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard label="Total Spent" value={totalSpent} icon={<TrendingUp className="text-blue-600" />} color="bg-blue-50" />
                <StatCard label="Monthly Spending" value={monthlySpent} icon={<TrendingUp className="text-emerald-600" />} color="bg-emerald-50" />
                <StatCard label="Active Accounts" value={accounts.length} icon={<Wallet className="text-amber-600" />} color="bg-amber-50" isCurrency={false} />
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                  <h3 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                    <PieChartIcon size={20} className="text-zinc-400" />
                    Spending by Category
                  </h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {categoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend verticalAlign="bottom" height={36}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                  <h3 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                    <CreditCard size={20} className="text-zinc-400" />
                    Spending by Account
                  </h3>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={accountData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} />
                        <YAxis axisLine={false} tickLine={false} />
                        <Tooltip cursor={{fill: '#f8f8f8'}} />
                        <Bar dataKey="value" fill="#18181b" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Budget Progress */}
              {budgets.length > 0 && (
                <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                  <h3 className="text-lg font-bold text-zinc-900 mb-6 flex items-center gap-2">
                    <Bell size={20} className="text-zinc-400" />
                    Budget Progress
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {budgets.map(budget => {
                      const now = new Date();
                      const interval = budget.period === 'Monthly' 
                        ? { start: startOfMonth(now), end: endOfMonth(now) }
                        : { start: startOfWeek(now), end: endOfWeek(now) };

                      const spent = expenses
                        .filter(exp => exp.category === budget.category && isWithinInterval(parseISO(exp.date), interval))
                        .reduce((sum, exp) => sum + exp.amount, 0);
                      
                      const percent = Math.min((spent / budget.amount) * 100, 100);
                      const isOver = spent > budget.amount;

                      return (
                        <div key={budget.id} className="space-y-2">
                          <div className="flex justify-between text-sm font-medium">
                            <span className="text-zinc-900">{budget.category} ({budget.period})</span>
                            <span className={isOver ? 'text-red-600' : 'text-zinc-500'}>
                              ₹{spent.toLocaleString()} / ₹{budget.amount.toLocaleString()}
                            </span>
                          </div>
                          <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${percent}%` }}
                              className={`h-full rounded-full ${isOver ? 'bg-red-500' : 'bg-zinc-900'}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent Expenses */}
              <div className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden">
                <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                  <h3 className="text-lg font-bold text-zinc-900">Recent Transactions</h3>
                  <button onClick={() => setActiveTab('expenses')} className="text-sm font-medium text-zinc-500 hover:text-zinc-900">View All</button>
                </div>
                <div className="divide-y divide-zinc-100">
                  {filteredExpenses.slice(0, 5).map(exp => (
                    <ExpenseItem key={exp.id} expense={exp} onDelete={() => deleteExpense(exp.id!)} />
                  ))}
                  {filteredExpenses.length === 0 && (
                    <div className="p-12 text-center text-zinc-500">No transactions match your filters.</div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'expenses' && (
            <motion.div 
              key="expenses"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white rounded-3xl border border-zinc-200 shadow-sm overflow-hidden"
            >
              <div className="divide-y divide-zinc-100">
                {filteredExpenses.map(exp => (
                  <ExpenseItem key={exp.id} expense={exp} onDelete={() => deleteExpense(exp.id!)} />
                ))}
                {filteredExpenses.length === 0 && (
                  <div className="p-12 text-center text-zinc-500">No transactions recorded for selected filters.</div>
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'accounts' && (
            <motion.div 
              key="accounts"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {accounts.map(acc => (
                <div key={acc.id} className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm hover:shadow-md transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-zinc-50 rounded-2xl text-zinc-900">
                      {acc.type === 'Credit Card' && <CreditCard size={24} />}
                      {acc.type === 'Debit Card' && <Banknote size={24} />}
                      {acc.type === 'UPI' && <Smartphone size={24} />}
                      {acc.type === 'Cash' && <Banknote size={24} />}
                    </div>
                    <span className="text-xs font-bold px-2 py-1 bg-zinc-100 rounded-lg text-zinc-500 uppercase tracking-wider">{acc.type}</span>
                  </div>
                  <h4 className="text-lg font-bold text-zinc-900 mb-1">{acc.name}</h4>
                  <p className="text-2xl font-bold text-zinc-900">₹{acc.balance?.toLocaleString() || 0}</p>
                </div>
              ))}
              <button 
                onClick={() => setShowAddAccount(true)}
                className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl flex flex-col items-center justify-center p-8 text-zinc-400 hover:text-zinc-900 hover:border-zinc-900 transition-all gap-2"
              >
                <Plus size={32} />
                <span className="font-bold">Add New Account</span>
              </button>
            </motion.div>
          )}

          {activeTab === 'budgets' && (
            <motion.div 
              key="budgets"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {budgets.map(budget => {
                const now = new Date();
                const interval = budget.period === 'Monthly' 
                  ? { start: startOfMonth(now), end: endOfMonth(now) }
                  : { start: startOfWeek(now), end: endOfWeek(now) };

                const spent = expenses
                  .filter(exp => exp.category === budget.category && isWithinInterval(parseISO(exp.date), interval))
                  .reduce((sum, exp) => sum + exp.amount, 0);
                
                const percent = Math.min((spent / budget.amount) * 100, 100);
                const isOver = spent > budget.amount;

                return (
                  <div key={budget.id} className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-3 bg-zinc-50 rounded-2xl text-zinc-900">
                        <Bell size={24} />
                      </div>
                      <button 
                        onClick={async () => {
                          await deleteDoc(doc(db, 'budgets', budget.id!));
                          addNotification("Budget deleted", "info");
                        }}
                        className="p-2 text-zinc-300 hover:text-red-600 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <h4 className="text-lg font-bold text-zinc-900 mb-1">{budget.category}</h4>
                    <p className="text-sm text-zinc-500 mb-4">{budget.period} Budget</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm font-bold">
                        <span className="text-zinc-900">₹{spent.toLocaleString()}</span>
                        <span className="text-zinc-400">/ ₹{budget.amount.toLocaleString()}</span>
                      </div>
                      <div className="h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${isOver ? 'bg-red-500' : 'bg-zinc-900'}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
              <button 
                onClick={() => setShowAddBudget(true)}
                className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl flex flex-col items-center justify-center p-8 text-zinc-400 hover:text-zinc-900 hover:border-zinc-900 transition-all gap-2"
              >
                <Plus size={32} />
                <span className="font-bold">Set New Budget</span>
              </button>
            </motion.div>
          )}

          {activeTab === 'recurring' && (
            <motion.div 
              key="recurring"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
            >
              {recurringExpenses.map(rec => (
                <div key={rec.id} className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 bg-zinc-50 rounded-2xl text-zinc-900">
                      <Repeat size={24} />
                    </div>
                    <button 
                      onClick={async () => {
                        await deleteDoc(doc(db, 'recurring_expenses', rec.id!));
                        addNotification("Recurring expense removed", "info");
                      }}
                      className="p-2 text-zinc-300 hover:text-red-600 transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <h4 className="text-lg font-bold text-zinc-900 mb-1">{rec.description}</h4>
                  <p className="text-sm text-zinc-500 mb-2">{rec.category} • {rec.frequency}</p>
                  <p className="text-xl font-bold text-zinc-900 mb-4">₹{rec.amount.toLocaleString()}</p>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <Calendar size={14} />
                    <span>Starts: {format(parseISO(rec.startDate), 'MMM d, yyyy')}</span>
                  </div>
                </div>
              ))}
              <button 
                onClick={() => setShowAddRecurring(true)}
                className="bg-zinc-50 border-2 border-dashed border-zinc-200 rounded-3xl flex flex-col items-center justify-center p-8 text-zinc-400 hover:text-zinc-900 hover:border-zinc-900 transition-all gap-2"
              >
                <Plus size={32} />
                <span className="font-bold">Add Recurring Expense</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showAddExpense && (
          <Modal title="Add New Expense" onClose={() => setShowAddExpense(false)}>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Amount (₹)</label>
                <input required name="amount" type="number" step="0.01" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="0.00" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Category</label>
                  <select required name="category" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Payment Method</label>
                  <select required name="paymentMethodId" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Description</label>
                <input name="description" type="text" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="What was this for?" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Date</label>
                <input name="date" type="datetime-local" defaultValue={new Date().toISOString().slice(0, 16)} className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" />
              </div>
              <button type="submit" className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all mt-4">Save Expense</button>
            </form>
          </Modal>
        )}

        {showAddAccount && (
          <Modal title="Add New Account" onClose={() => setShowAddAccount(false)}>
            <form onSubmit={handleAddAccount} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Account Name</label>
                <input required name="name" type="text" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="e.g. HDFC Credit Card" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Account Type</label>
                <select required name="type" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                  {ACCOUNT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Initial Balance / Limit (₹)</label>
                <input name="balance" type="number" step="0.01" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="0.00" />
              </div>
              <button type="submit" className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all mt-4">Create Account</button>
            </form>
          </Modal>
        )}

        {showAddBudget && (
          <Modal title="Set Category Budget" onClose={() => setShowAddBudget(false)}>
            <form onSubmit={handleAddBudget} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Budget Amount (₹)</label>
                <input required name="amount" type="number" step="0.01" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="0.00" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Category</label>
                  <select required name="category" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Period</label>
                  <select required name="period" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {BUDGET_PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all mt-4">Set Budget</button>
            </form>
          </Modal>
        )}

        {showAddRecurring && (
          <Modal title="Setup Recurring Expense" onClose={() => setShowAddRecurring(false)}>
            <form onSubmit={handleAddRecurring} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Amount (₹)</label>
                <input required name="amount" type="number" step="0.01" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="0.00" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Category</label>
                  <select required name="category" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Payment Method</label>
                  <select required name="paymentMethodId" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">Description</label>
                <input name="description" type="text" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" placeholder="e.g. Netflix Subscription" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Frequency</label>
                  <select required name="frequency" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none">
                    {RECURRING_FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-zinc-900">Start Date</label>
                  <input required name="startDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-zinc-900">End Date (Optional)</label>
                <input name="endDate" type="date" className="w-full p-4 bg-zinc-50 rounded-2xl border-none focus:ring-2 focus:ring-zinc-900 outline-none" />
              </div>
              <button type="submit" className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all mt-4">Setup Recurring</button>
            </form>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-medium ${
        active 
          ? 'bg-zinc-900 text-white shadow-lg shadow-zinc-200' 
          : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}

function StatCard({ label, value, icon, color, isCurrency = true }: { label: string, value: number, icon: React.ReactNode, color: string, isCurrency?: boolean }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-zinc-200 shadow-sm flex items-center gap-4">
      <div className={`p-4 rounded-2xl ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        <p className="text-2xl font-bold text-zinc-900">
          {isCurrency ? `₹${value.toLocaleString()}` : value}
        </p>
      </div>
    </div>
  );
}

interface ExpenseItemProps {
  expense: Expense;
  onDelete: () => void | Promise<void>;
  key?: string | number;
}

function ExpenseItem({ expense, onDelete }: ExpenseItemProps) {
  return (
    <div className="group flex items-center justify-between p-4 hover:bg-zinc-50 transition-all">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-zinc-100 rounded-xl flex items-center justify-center text-zinc-500">
          {expense.category === 'Food' && '🍔'}
          {expense.category === 'Entertainment' && '🎬'}
          {expense.category === 'Transport' && '🚗'}
          {expense.category === 'Shopping' && '🛍️'}
          {expense.category === 'Bills' && '📄'}
          {expense.category === 'Health' && '🏥'}
          {expense.category === 'Education' && '📚'}
          {expense.category === 'Others' && '📦'}
        </div>
        <div>
          <p className="font-bold text-zinc-900">{expense.description || expense.category}</p>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>{expense.paymentMethodName}</span>
            <span>•</span>
            <span>{format(parseISO(expense.date), 'MMM d, h:mm a')}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <p className="text-lg font-bold text-zinc-900">-₹{expense.amount.toLocaleString()}</p>
        <button 
          onClick={() => onDelete()}
          className="p-2 text-zinc-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-zinc-900/40 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden"
      >
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-xl font-bold text-zinc-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-all">
            <X size={20} />
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </motion.div>
    </div>
  );
}
