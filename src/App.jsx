import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";
import { MENU, BREADS, SAUCES } from "./menu";

const money = n => `${n} DA`;
const times = () => {
  const out = [];
  for (let m = 11 * 60 + 30; m <= 21 * 60 + 30; m += 15) {
    out.push(`${String(Math.floor(m / 60)).padStart(2,"0")}:${String(m % 60).padStart(2,"0")}`);
  }
  return out;
};
const STATUS = { new: "Nouvelle", accepted: "Acceptée", preparing: "En préparation", ready: "Prête", collected: "Récupérée", rejected: "Refusée" };

export default function App() {
  const [adminMode, setAdminMode] = useState(location.hash === "#admin");
  const [settings, setSettings] = useState({ accepting_orders: true, opening_time: "11:30", closing_time: "21:30" });
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState({ name: "", phone: "", pickup: "12:00", note: "" });
  const [message, setMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [session, setSession] = useState(null);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("shop_settings").select("*").eq("id", 1).single().then(({data}) => { if (data) setSettings(data); });
    supabase.auth.getSession().then(({data}) => setSession(data.session));
    const { data: auth } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => auth.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !adminMode || !session) return;
    const load = async () => {
      const { data } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
      if (data) setOrders(data);
    };
    load();
    const channel = supabase.channel("admin-orders").on("postgres_changes",
      { event: "*", schema: "public", table: "orders" }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [adminMode, session]);

  const total = useMemo(() => cart.reduce((s, x) => s + x.price * x.qty, 0), [cart]);
  const add = item => {
    const bread = BREADS[0];
    setCart(old => {
      const found = old.find(x => x.id === item.id && x.bread === bread);
      return found ? old.map(x => x === found ? {...x, qty: x.qty + 1} : x)
        : [...old, { ...item, qty: 1, bread, sauces: ["Mayonnaise", "Sauce Maison"] }];
    });
  };
  const updateLine = (idx, patch) => setCart(old => old.map((x,i) => i === idx ? {...x,...patch} : x));
  const removeLine = idx => setCart(old => old.filter((_,i) => i !== idx));

  async function submitOrder(e) {
    e.preventDefault(); setMessage("");
    if (!supabase) return setMessage("Configuration Supabase manquante. Consultez le fichier README.");
    if (!settings.accepting_orders) return setMessage("Les commandes en ligne sont momentanément suspendues.");
    if (!cart.length) return setMessage("Ajoutez au moins un sandwich.");
    setBusy(true);
    const payload = {
      customer_name: customer.name.trim(), customer_phone: customer.phone.trim(),
      pickup_time: customer.pickup, note: customer.note.trim(),
      items: cart.map(({id,name,price,qty,bread,sauces}) => ({id,name,price,qty,bread,sauces})),
      total, status: "new"
    };
    const { data, error } = await supabase.from("orders").insert(payload).select("order_number").single();
    setBusy(false);
    if (error) return setMessage("Impossible d'envoyer la commande : " + error.message);
    setMessage(`Commande confirmée ! Votre numéro : ${data.order_number}. Paiement en espèces au retrait.`);
    setCart([]);
    setCustomer({ name: "", phone: "", pickup: "12:00", note: "" });
  }

  async function signIn(e) {
    e.preventDefault(); if (!supabase) return;
    const { error } = await supabase.auth.signInWithPassword(login);
    if (error) setMessage(error.message); else setMessage("");
  }
  async function setStatus(id, status) {
    const { error } = await supabase.from("orders").update({status}).eq("id", id);
    if (error) alert(error.message);
  }
  async function toggleOrders() {
    const next = !settings.accepting_orders;
    const { error } = await supabase.from("shop_settings").update({accepting_orders: next}).eq("id",1);
    if (error) return alert(error.message);
    setSettings(s => ({...s, accepting_orders: next}));
  }

  if (adminMode) return <main className="wrap">
    <header><a className="brand" href="#">K’S Bite <span>Express</span></a><button className="ghost" onClick={() => {setAdminMode(false); location.hash="";}}>Espace client</button></header>
    <h1>Administration</h1>
    {!supabase && <p className="notice">Configurez d'abord Supabase dans le fichier .env.</p>}
    {!session ? <form className="panel narrow" onSubmit={signIn}>
      <h2>Connexion administrateur</h2>
      <label>Email<input type="email" required value={login.email} onChange={e=>setLogin({...login,email:e.target.value})}/></label>
      <label>Mot de passe<input type="password" required value={login.password} onChange={e=>setLogin({...login,password:e.target.value})}/></label>
      <button disabled={!supabase}>Se connecter</button>
      {message && <p>{message}</p>}
    </form> : <>
      <div className="toolbar"><button onClick={toggleOrders}>{settings.accepting_orders ? "Suspendre les commandes" : "Reprendre les commandes"}</button><button className="ghost" onClick={()=>supabase.auth.signOut()}>Déconnexion</button></div>
      <p className="muted">Commandes : {orders.length} · Mise à jour en direct lorsque la connexion est active.</p>
      {orders.map(o=><section className="panel order" key={o.id}>
        <div className="orderhead"><strong>Commande #{o.order_number}</strong><span className={`status ${o.status}`}>{STATUS[o.status] || o.status}</span></div>
        <p>{o.customer_name} · {o.customer_phone} · Retrait {o.pickup_time}</p>
        {(o.items || []).map((it,i)=><p key={i}>{it.qty} × {it.name} — {it.bread} — {(it.sauces||[]).join(", ")}</p>)}
        {o.note && <p>Note : {o.note}</p>}<strong>{money(o.total)}</strong>
        <div className="actions">
          {["accepted","preparing","ready","collected","rejected"].map(s=><button key={s} className="small" onClick={()=>setStatus(o.id,s)}>{STATUS[s]}</button>)}
        </div>
      </section>)}
    </>}
  </main>;

  return <main className="wrap">
    <header><a className="brand" href="#">K’S Bite <span>Express</span></a><button className="ghost" onClick={()=>{setAdminMode(true);location.hash="admin";}}>Admin</button></header>
    <section className="hero"><p className="eyebrow">THE SPECIAL TASTE</p><h1>Commandez maintenant.<br/>Récupérez sans attendre.</h1><p>Choisissez votre sandwich et votre heure de retrait.</p><div className="hours">Ouvert de 11:30 à 21:30</div></section>
    {!settings.accepting_orders && <p className="notice">Les commandes en ligne sont temporairement suspendues.</p>}
    <h2>Notre menu</h2><div className="menu">
      {MENU.map(item=><article className="panel food" key={item.id}><div><h3>{item.name}</h3><p>{item.description}</p><strong>{money(item.price)}</strong></div><button onClick={()=>add(item)}>Ajouter +</button></article>)}
    </div>
    <form className="panel checkout" onSubmit={submitOrder}>
      <h2>Votre commande</h2>
      {!cart.length ? <p className="muted">Votre panier est vide.</p> : cart.map((x,i)=><div className="cartline" key={i}>
        <div className="linehead"><strong>{x.name}</strong><button type="button" className="link" onClick={()=>removeLine(i)}>Supprimer</button></div>
        <div className="fields">
          <label>Quantité<input type="number" min="1" max="30" value={x.qty} onChange={e=>updateLine(i,{qty:Math.max(1,Number(e.target.value))})}/></label>
          <label>Pain<select value={x.bread} onChange={e=>updateLine(i,{bread:e.target.value})}>{BREADS.map(b=><option key={b}>{b}</option>)}</select></label>
        </div>
        <label>Sauces</label><div className="checks">{SAUCES.map(s=><label key={s}><input type="checkbox" checked={x.sauces.includes(s)} onChange={e=>updateLine(i,{sauces:e.target.checked?[...x.sauces,s]:x.sauces.filter(v=>v!==s)})}/>{s}</label>)}</div>
      </div>)}
      <div className="total">Total <strong>{money(total)}</strong></div>
      <div className="fields">
        <label>Votre nom<input required value={customer.name} onChange={e=>setCustomer({...customer,name:e.target.value})}/></label>
        <label>Téléphone<input required type="tel" value={customer.phone} onChange={e=>setCustomer({...customer,phone:e.target.value})}/></label>
        <label>Heure de retrait<select value={customer.pickup} onChange={e=>setCustomer({...customer,pickup:e.target.value})}>{times().map(t=><option key={t}>{t}</option>)}</select></label>
      </div>
      <label>Remarque (facultatif)<textarea rows="2" value={customer.note} onChange={e=>setCustomer({...customer,note:e.target.value})}/></label>
      <p className="muted">Paiement en espèces au retrait à la boutique.</p>
      <button className="submit" disabled={busy || !cart.length || !settings.accepting_orders}>{busy ? "Envoi..." : "Confirmer la commande"}</button>
      {message && <p className="notice">{message}</p>}
    </form>
    <footer>K’S Bite · The special taste</footer>
  </main>;
}
