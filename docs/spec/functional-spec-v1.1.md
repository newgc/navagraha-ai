**NAVAGRAHA AI**

**MVP Functional Specification**

**V1.0**

Engineering-ready translation of PRD V1.0 + Master Product Audit V1.0\
Updated: 08 October 2026

*"AI plans it. Local experts execute it."*

  -----------------------------------------------------------------------
  **Document**                        **Baseline**
  ----------------------------------- -----------------------------------
  Product Requirements                NAVAGRAHA AI PRD V1.0

  Audit                               Master Product Audit V1.0 ---
                                      reconciled with PRD

  Decision Engine                     AI Decision & Itinerary Engine
                                      Specification V1.0

  UX                                  Product UX Blueprint V1.0

  UI Content                          Figma Wireframe Content & UI Copy
                                      Specification V1.0

  Design System                       Figma Design System & Component
                                      Specification V1.0

  Screen Spec                         Figma-ready Screen Specification
                                      V1.0

  Owner                               Vaithy --- Product Owner

  Specification status                Engineering baseline; open business
                                      decisions explicitly preserved
  -----------------------------------------------------------------------

This document is the functional bridge between product intent and
implementation. It does not silently close business decisions that
remain open in the audit.

# 1. Purpose and Scope

This specification converts the reconciled PRD V1.0 and Master Product
Audit V1.0 into an implementation-oriented MVP contract. It defines what
the MVP must do, how the major workflows behave, what the AI is
permitted to do, how operations execute trips, and what must remain
explicitly open for Product Owner or business approval.

## 1.1 Product promise

A pilgrim should be able to move from "I want to visit the Navagraha
temples" to a feasible, transparent, executable pilgrimage with minimal
decision burden.

-   AI plans; verified product rules validate; operations execute.

-   No invented temple facts, prices, availability, traffic or service
    status.

-   Customer and operations experience are one connected system.

-   The MVP optimises reliability and completed trips before autonomous
    optimisation.

## 1.2 Functional boundary

  ---------------------------------------------------------------------------
  **Area**                **MVP**                     **Deferred**
  ----------------------- --------------------------- -----------------------
  Planning                Conversational planner,     Free-form optimisation,
                          1-day and 2D/1N templates,  broad circuit planning
                          Fast/Balanced/Relaxed       

  Booking                 Quote, booking request,     Full autonomous
                          payment gateway, fulfilment third-party procurement
                          status                      

  Operations              Trip board, assignments,    Advanced fleet
                          service confirmations,      optimisation
                          events, manual replanning   

  Live journey            Minimal P0 trip progress    Rich GPS/AI autonomous
                          and ops event updates       tracking

  Passport                9/9 completion from         Self-asserted
                          validated operational       completion
                          events                      

  Send My Parents         Core                        Full family live view
                          booking/contact/milestone   unless separately
                          notifications               approved

  AI                      Understand + explain +      LLM-driven
                          recommendation              transactional execution
                          orchestration               
  ---------------------------------------------------------------------------

# 2. Product Principles and Architecture Guardrails

The central engineering principle is:

**LLM understands and explains. The product engine decides. The
operations platform executes.**

## 2.1 Decision authority

  -----------------------------------------------------------------------------
  **Decision**            **Authority**                 **LLM role**
  ----------------------- ----------------------------- -----------------------
  Temple facts/timings    Verified master data /        Explain only
                          operations                    

  Feasibility             Deterministic itinerary       Present rationale
                          engine                        

  Pricing                 Quote/rate engine             Explain quote

  Availability            Provider/operations           Ask/communicate
                          confirmation                  

  Booking confirmation    Booking + fulfilment state    Communicate
                          machine                       

  Temple completion       Driver/operations/validated   Display
                          event                         

  Replanning              Rules/feasibility engine +    Explain recommended
                          operations                    change
  -----------------------------------------------------------------------------

## 2.2 Architecture

-   Frontend: Next.js / responsive web + PWA approach.

-   Backend: .NET 10 LTS recommended; final selection remains D-10.

-   Architecture: modular monolith for MVP, with clean domain
    boundaries.

-   Database: PostgreSQL.

-   AI: LLM behind an adapter; structured prompts and JSON contracts.

-   External providers: payment, WhatsApp, maps, email/SMS and
    hotel/service providers behind adapters.

-   Observability: structured logs, audit events, correlation IDs and
    provider response tracking.

Recommended module boundary: Identity, Traveller, Temple, Itinerary,
Quote, Booking, Payment, Hotel/Service Fulfilment, Trip/Operations,
Notifications, Content, AI/Decision, Analytics, Audit.

# 3. Decision Register D-01--D-17

  ---------------------------------------------------------------------------------
  **ID**            **Decision**      **Status**        **Specification treatment**
  ----------------- ----------------- ----------------- ---------------------------
  D-01              PRD received      Closed            PRD V1.0 is the requirement
                                                        baseline.

  D-02              Plan taxonomy     Partly closed     Fast/Balanced/Relaxed modes
                                                        are retained.
                                                        Essential/Comfort/Premium
                                                        tier taxonomy remains open;
                                                        recommended model is
                                                        templates × tiers, with
                                                        Senior-Friendly as a mode.

  D-03              CTA / positioning Closed            Use "Your AI Pilgrimage
                                                        Manager" and primary CTA
                                                        "Plan My Pilgrimage",
                                                        aligned to PRD Appendix B.

  D-04              State machines    Open              Approve canonical Trip,
                                                        Booking, Payment,
                                                        Fulfilment and Cancellation
                                                        states before engineering
                                                        locks API contracts.

  D-05              Passport          Closed            Operations / validated
                    completion                          journey events only; no
                    authority                           customer self-completion.

  D-06              Deposit /         Open              Business policy required
                    cancellation /                      before production payment
                    refund                              flow.

  D-07              GST treatment     Open              Confirm with finance/CA and
                                                        encode tax rules, not
                                                        hard-coded UI text.

  D-08              Rate card /       Open              Approve package, vehicle,
                    margins                             hotel, service and margin
                                                        model.

  D-09              Pickup service    Open              Define included pickup
                    area                                geography, surcharge zones
                                                        and exclusions.

  D-10              .NET 10           Open /            Recommend .NET 10 LTS for
                                      Recommended       new build; formal owner
                                                        approval required.

  D-11              Vendors           Open              Select payment gateway,
                                                        WhatsApp BSP, maps and LLM
                                                        provider through
                                                        adapter-compatible
                                                        evaluation.

  D-12              Send My Parents   Open /            Make core booking +
                    scope             Recommended       contacts + milestone
                                                        notifications P0; keep full
                                                        family live view P1.

  D-13              North Star        Open              Retain conversion KPI but
                                                        add completed-trip
                                                        CSAT/outcome metric; owner
                                                        to approve final wording.

  D-14              "Confirmed in 10  Open              Validate against manual
                    min" promise                        hotel/service confirmation.
                                                        Consider "plan/quote in
                                                        \<10 min" if full
                                                        confirmation cannot be
                                                        reliably achieved.

  D-15              Driver page       Open              Preferred P1 driver
                                                        signed-link experience; if
                                                        deferred, coordinator
                                                        records events by phone/ops
                                                        UI.

  D-16              PRD V1.1 fixes    Open              Resolve passport/live
                                                        journey/pooja priority
                                                        conflicts,
                                                        Quote/RateCard/Package
                                                        entities, traceability,
                                                        Circuit entity and timeline
                                                        references.

  D-17              Timeline          Open              Recommended 16-week build +
                                                        20--50 trip pilot, or
                                                        90-day reduced scope with
                                                        explicit owner sign-off.
  ---------------------------------------------------------------------------------

# 4. PRD Requirement Implementation Matrix

All 78 PRD requirements are preserved below. P0 items form the primary
MVP contract unless superseded by an explicit audit deviation or open
decision.

## 4.1 Identity & Traveller Profiles

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-ID-001        P0                Support mobile    MVP
                                      OTP and/or email  
                                      authentication.   

  NAV-ID-002        P0                Allow a booker to MVP
                                      create one or     
                                      more traveller    
                                      profiles.         

  NAV-ID-003        P0                Capture traveller MVP
                                      age band,         
                                      mobility          
                                      considerations,   
                                      food preference   
                                      and emergency     
                                      contact where     
                                      appropriate.      

  NAV-ID-004        P0                Allow a booker to MVP
                                      identify whether  
                                      they are          
                                      travelling or     
                                      booking for       
                                      someone else.     
  --------------------------------------------------------------------------

## 4.2 AI Pilgrimage Planner

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-AI-001        P0                Start with an     MVP
                                      open              
                                      conversational    
                                      prompt such as    
                                      "Plan my          
                                      Navagraha         
                                      pilgrimage".      

  NAV-AI-002        P0                Progressively     MVP
                                      collect origin,   
                                      travel date,      
                                      group             
                                      composition,      
                                      purpose, days,    
                                      vehicle, hotel    
                                      and service       
                                      preferences.      

  NAV-AI-003        P0                Ask only          MVP
                                      information that  
                                      materially        
                                      changes the       
                                      recommendation.   

  NAV-AI-004        P0                Generate Fast,    MVP
                                      Balanced and      
                                      Relaxed plan      
                                      modes when        
                                      feasible.         

  NAV-AI-005        P0                Recommend 1-day   MVP
                                      vs 2-day based on 
                                      feasibility,      
                                      comfort, travel   
                                      efficiency and    
                                      traveller         
                                      profile.          

  NAV-AI-006        P0                Explain why the   MVP
                                      recommended       
                                      option is         
                                      preferred.        

  NAV-AI-007        P0                Never invent      MVP
                                      price,            
                                      availability,     
                                      timing or         
                                      operational       
                                      status.           

  NAV-AI-008        P0                Clearly label     MVP
                                      information as    
                                      Estimated,        
                                      Recommended or    
                                      Confirmed.        
  --------------------------------------------------------------------------

## 4.3 Itinerary Engine

  ------------------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**             **Implementation**
  ----------------- ----------------- --------------------------- --------------------
  NAV-IT-001        P0                Maintain a structured       MVP
                                      itinerary containing        
                                      temples, sequence, target   
                                      arrival/departure, travel   
                                      legs, breaks and services.  

  NAV-IT-002        P0                Apply configurable          MVP
                                      constraints for opening     
                                      hours, service windows,     
                                      travel time, meal breaks    
                                      and trip duration.          

  NAV-IT-003        P0                Support one-day and two-day MVP
                                      itineraries in MVP.         

  NAV-IT-004        P0                Version itineraries         MVP
                                      whenever the customer or    
                                      operations team changes     
                                      them.                       

  NAV-IT-005        P0                Store original plan,        MVP
                                      user-modified plan and      
                                      operations/live-replanned   
                                      versions.                   

  NAV-IT-006        P1                Recalculate remaining       P1 / later unless
                                      feasibility after a delay   required dependency
                                      or service change.          
  ------------------------------------------------------------------------------------

## 4.4 Temple Information

  ---------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**    **Implementation**
  ----------------- ----------------- ------------------ --------------------
  NAV-TEM-001       P0                Maintain a         MVP
                                      verified master    
                                      record for all     
                                      nine Navagraha     
                                      temples.           

  NAV-TEM-002       P0                Store address,     MVP
                                      coordinates,       
                                      source, normal     
                                      operating          
                                      information and    
                                      operational notes. 

  NAV-TEM-003       P0                Show source and    MVP
                                      last-verified date 
                                      for operationally  
                                      sensitive          
                                      information.       

  NAV-TEM-004       P1                Provide            P1 / later unless
                                      temple-specific    required dependency
                                      visit guidance:    
                                      next action,       
                                      parking/entrance   
                                      notes, estimated   
                                      visit duration and 
                                      next leg.          

  NAV-TEM-005       P1                Support            P1 / later unless
                                      multilingual       required dependency
                                      content and future 
                                      audio guidance.    
  ---------------------------------------------------------------------------

## 4.5 Vehicle & Driver

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-VEH-001       P0                Maintain vehicle  MVP
                                      inventory, type,  
                                      capacity, comfort 
                                      level and         
                                      availability.     

  NAV-VEH-002       P0                Recommend a       MVP
                                      vehicle based on  
                                      traveller count,  
                                      senior needs,     
                                      luggage and       
                                      budget.           

  NAV-VEH-003       P0                Assign driver to  MVP
                                      confirmed trips.  

  NAV-VEH-004       P0                Track driver/trip MVP
                                      status and        
                                      operational       
                                      notes.            

  NAV-VEH-005       P1                Support future    P1 / later unless
                                      live GPS          required dependency
                                      tracking.         
  --------------------------------------------------------------------------

## 4.6 Hotel

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-HOT-001       P0                Maintain partner  MVP
                                      hotels, room      
                                      types, location,  
                                      capacity, pricing 
                                      and availability  
                                      status.           

  NAV-HOT-002       P0                Recommend hotel   MVP
                                      based on route,   
                                      comfort,          
                                      traveller profile 
                                      and budget.       

  NAV-HOT-003       P0                Show hotel cost   MVP
                                      separately from   
                                      transport and     
                                      service fees.     

  NAV-HOT-004       P0                Support hotel     MVP
                                      confirmation      
                                      workflow before   
                                      booking           
                                      completion.       
  --------------------------------------------------------------------------

## 4.7 Pooja / Pariharam

  --------------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**         **Implementation**
  ----------------- ----------------- ----------------------- --------------------
  NAV-POO-001       P0                Allow customers to      MVP
                                      state desired           
                                      pooja/pariharam intent. 

  NAV-POO-002       P0                Present available       MVP
                                      service options only    
                                      from                    
                                      configured/verified     
                                      offerings.              

  NAV-POO-003       P0                Capture service date,   MVP
                                      temple, participant     
                                      count and service       
                                      status.                 

  NAV-POO-004       P0                Clearly distinguish     MVP
                                      traditional/religious   
                                      information from        
                                      product                 
                                      recommendations.        
  --------------------------------------------------------------------------------

## 4.8 Quote, Booking & Payment

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-BOOK-001      P0                Generate a        MVP
                                      deterministic     
                                      quote from        
                                      selected          
                                      services.         

  NAV-BOOK-002      P0                Show transparent  MVP
                                      line-item pricing 
                                      and applicable    
                                      taxes/fees.       

  NAV-BOOK-003      P0                Support booking   MVP
                                      request,          
                                      confirmation,     
                                      cancellation and  
                                      payment status.   

  NAV-BOOK-004      P0                Integrate an      MVP
                                      India-ready       
                                      payment gateway   
                                      in MVP.           

  NAV-BOOK-005      P0                Issue digital     MVP
                                      booking           
                                      confirmation and  
                                      invoice/receipt   
                                      where applicable. 

  NAV-BOOK-006      P1                Support           P1 / later unless
                                      coupon/discount   required dependency
                                      logic as          
                                      configurable      
                                      rules.            
  --------------------------------------------------------------------------

## 4.9 WhatsApp & Notifications

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-NOT-001       P0                Send planning     MVP
                                      summary, quote,   
                                      booking           
                                      confirmation,     
                                      pickup details    
                                      and trip          
                                      reminders through 
                                      WhatsApp.         

  NAV-NOT-002       P0                Support SMS/email MVP
                                      fallback for      
                                      critical          
                                      messages.         

  NAV-NOT-003       P0                Maintain          MVP
                                      notification      
                                      delivery status   
                                      and audit trail.  

  NAV-NOT-004       P1                Allow customer    P1 / later unless
                                      communication     required dependency
                                      preferences.      
  --------------------------------------------------------------------------

## 4.10 Customer Trip Dashboard

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-TRIP-001      P0                Show upcoming and MVP
                                      past trips.       

  NAV-TRIP-002      P0                Show confirmed    MVP
                                      services,         
                                      itinerary,        
                                      booking/payment   
                                      status and        
                                      contacts.         

  NAV-TRIP-003      P1                Show live journey Promote to minimal
                                      progress once     P0 Live Journey:
                                      trip starts.      progress/status from
                                                        validated trip
                                                        events; rich live
                                                        tracking remains P1.

  NAV-TRIP-004      P0                Allow access to   MVP
                                      digital           
                                      pilgrimage        
                                      passport.         
  --------------------------------------------------------------------------

## 4.11 Digital Pilgrimage Passport

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-PASS-001      P0                Track completion  MVP
                                      status for all    
                                      nine temples.     

  NAV-PASS-002      P0                Allow operations  MVP
                                      or validated      
                                      journey events to 
                                      mark temple       
                                      completion.       

  NAV-PASS-003      P0                Show progress     MVP
                                      such as 4/9       
                                      completed.        

  NAV-PASS-004      P1                Generate a        P1; certificate is
                                      completion        generated only after
                                      certificate when  validated 9/9
                                      9/9 is completed. completion.
  --------------------------------------------------------------------------

## 4.12 Live Journey Mode

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-LIVE-001      P1                Show current      P1 / later unless
                                      temple, next      required dependency
                                      temple, ETA and   
                                      progress.         

  NAV-LIVE-002      P1                Provide           P1 / later unless
                                      actionable        required dependency
                                      guidance for each 
                                      leg.              

  NAV-LIVE-003      P1                Allow operations  Promote to P0
                                      to record delay,  operational baseline
                                      temple            per audit: ops must
                                      completion,       be able to record
                                      meal/rest stop    events and
                                      and service       trigger/prepare
                                      changes.          replanning.

  NAV-LIVE-004      P1                Trigger           Promote to P0
                                      re-planning when  operational baseline
                                      remaining         per audit: ops must
                                      itinerary         be able to record
                                      feasibility       events and
                                      changes.          trigger/prepare
                                                        replanning.
  --------------------------------------------------------------------------

## 4.13 Senior-Friendly Mode

  ----------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**     **Implementation**
  ----------------- ----------------- ------------------- --------------------
  NAV-SEN-001       P0                Detect or           MVP
                                      explicitly capture  
                                      senior travellers.  

  NAV-SEN-002       P0                Increase break/rest MVP
                                      requirements based  
                                      on configurable     
                                      rules.              

  NAV-SEN-003       P0                Prefer comfortable  MVP
                                      vehicles and        
                                      route/hotel options 
                                      when available.     

  NAV-SEN-004       P0                Minimise            MVP
                                      unnecessary walking 
                                      and operational     
                                      uncertainty where   
                                      data permits.       

  NAV-SEN-005       P0                Show a clear        MVP
                                      "Senior-Friendly"   
                                      plan badge.         
  ----------------------------------------------------------------------------

## 4.14 Send My Parents

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-PAR-001       P1                Allow adult child Promote core
                                      to create and     capability to P0:
                                      manage a parent   parent trip setup,
                                      trip.             consent/contact and
                                                        milestone
                                                        notifications. Full
                                                        family live view
                                                        remains P1.

  NAV-PAR-002       P1                Send milestone    Promote core
                                      notifications:    capability to P0:
                                      pickup, temple    parent trip setup,
                                      completion,       consent/contact and
                                      lunch/rest, hotel milestone
                                      check-in and day  notifications. Full
                                      completion.       family live view
                                                        remains P1.

  NAV-PAR-003       P1                Provide a         P1 / later unless
                                      family-facing     required dependency
                                      live trip view.   

  NAV-PAR-004       P1                Allow emergency   P1 / later unless
                                      contact and       required dependency
                                      support           
                                      escalation.       
  --------------------------------------------------------------------------

## 4.15 Operations Dashboard

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-OPS-001       P0                Show today's      MVP
                                      trips with        
                                      customer,         
                                      travellers,       
                                      vehicle, driver,  
                                      route and status. 

  NAV-OPS-002       P0                Open a trip       MVP
                                      detail view with  
                                      full operational  
                                      timeline.         

  NAV-OPS-003       P0                Assign/change     MVP
                                      driver and        
                                      vehicle.          

  NAV-OPS-004       P0                Manage hotel and  MVP
                                      service           
                                      confirmation      
                                      status.           

  NAV-OPS-005       P0                Modify itinerary  MVP
                                      and record reason 
                                      for change.       

  NAV-OPS-006       P0                Contact           MVP
                                      customer/driver   
                                      from trip detail. 

  NAV-OPS-007       P0                Track payment,    MVP
                                      cancellation and  
                                      refund state.     
  --------------------------------------------------------------------------

## 4.16 Driver Experience

  --------------------------------------------------------------------------
  **ID**            **Priority**      **Requirement**   **Implementation**
  ----------------- ----------------- ----------------- --------------------
  NAV-DRV-001       P1                Show assigned     P1 / later unless
                                      trip and          required dependency
                                      itinerary.        

  NAV-DRV-002       P1                Show customer     P1 / later unless
                                      pickup details    required dependency
                                      and contact       
                                      rules.            

  NAV-DRV-003       P1                Allow status      P1 / later unless
                                      updates such as   required dependency
                                      Arrived, Picked   
                                      Up, At Temple,    
                                      Completed,        
                                      Delayed.          

  NAV-DRV-004       P1                Capture           P1 / later unless
                                      operational       required dependency
                                      notes/issues.     
  --------------------------------------------------------------------------

# 5. Missing Requirements MR-01--MR-56

The audit identified 56 missing/under-specified requirements: 5 already
covered by the PRD, 26 partially covered and 25 absent. Because the
audit summary does not reproduce the full MR wording, this section
defines the functional resolution categories that must be incorporated
into engineering rather than inventing an audit quotation.

  -----------------------------------------------------------------------
  **Range**               **Audit status**        **Required action**
  ----------------------- ----------------------- -----------------------
  MR-01--MR-05            Already covered         Verify traceability to
                                                  the corresponding PRD
                                                  requirement during
                                                  backlog grooming; no
                                                  duplicate
                                                  implementation.

  MR-06--MR-31            Partly covered          Expand into explicit
                                                  acceptance criteria for
                                                  state transitions,
                                                  provider failures, data
                                                  provenance, quote
                                                  reproducibility,
                                                  consent, notifications,
                                                  operations events and
                                                  auditability.

  MR-32--MR-56            Absent / material gap   Create backlog stories
                                                  before build for state
                                                  machines,
                                                  quote/rate-card model,
                                                  supplier confirmation,
                                                  payment/fulfilment
                                                  separation, event
                                                  authority,
                                                  retry/idempotency,
                                                  operational fallback,
                                                  security and analytics.
  -----------------------------------------------------------------------

## 5.1 Mandatory gap categories before development lock

-   Canonical state machines and allowed transitions.

-   Quote, RateCard and Package domain objects for reproducible pricing.

-   Payment status separated from fulfilment status.

-   Provider idempotency, retries, timeout and compensation behaviour.

-   Consent and contact rules for Send My Parents.

-   Source, timestamp and last-verified metadata for operational facts.

-   Operational event authority and Passport completion rules.

-   Audit trail for AI recommendation inputs, rules and output versions.

-   Circuit/template model so future circuits do not require schema
    redesign.

-   Explicit refund, cancellation and tax configuration.

# 6. Edge Case Handling EC-01--EC-38

The following handling contract is the MVP baseline. Exact EC wording
should be reconciled against the full Claude audit artifact during
backlog grooming.

  ------------------------------------------------------------------------
  **ID**                  **Scenario**            **MVP behaviour**
  ----------------------- ----------------------- ------------------------
  EC-01                   Incomplete planner      Ask only the next
                          input                   material question;
                                                  preserve session state.

  EC-02                   Impossible 1-day plan   Do not promise
                                                  completion; explain
                                                  constraint and offer
                                                  2-day option.

  EC-03                   Senior-heavy group      Apply Senior-Friendly
                                                  rules and re-score
                                                  options.

  EC-04                   Temple/service          Remove or flag service
                          unavailable             and route to operations;
                                                  never fabricate
                                                  availability.

  EC-05                   Hotel unavailable       Keep booking pending or
                                                  offer verified
                                                  alternatives.

  EC-06                   Vehicle unavailable     Re-run vehicle
                                                  recommendation and quote
                                                  delta.

  EC-07                   Payment success but     Payment = successful;
                          booking not confirmed   fulfilment = pending.
                                                  Create reconciliation
                                                  task.

  EC-08                   Booking confirmed but   Persist confirmed state
                          notification fails      and retry notification;
                                                  show status in
                                                  dashboard.

  EC-09                   Provider timeout        Use idempotent retry; do
                                                  not create duplicate
                                                  booking.

  EC-10                   Duplicate payment       Ignore duplicate event
                          webhook                 after idempotency check.

  EC-11                   Customer changes date   Create new
                                                  itinerary/quote version
                                                  and re-check
                                                  availability.

  EC-12                   Customer changes group  Recalculate vehicle,
                          size                    hotel, pooja and price.

  EC-13                   Late arrival to         Re-run remaining
                          Kumbakonam              feasibility and notify
                                                  operations.

  EC-14                   Long temple visit       Record delay; evaluate
                                                  remaining circuit
                                                  feasibility.

  EC-15                   Traffic delay           Use verified
                                                  map/provider data when
                                                  available; otherwise
                                                  label estimate.

  EC-16                   Driver issue            Operations reassigns
                                                  vehicle/driver and
                                                  records event.

  EC-17                   Temple event/special    Operations overrides
                          closure                 template with reason and
                                                  source.

  EC-18                   Customer requests       Explain scope; do not
                          unsupported ritual      claim religious
                                                  authority.

  EC-19                   Customer asks           Separate
                          medical/astrological    belief/tradition from
                          claim                   medical/scientific fact.

  EC-20                   Customer self-reports   Do not mark Passport
                          completion              complete without
                                                  validated event.

  EC-21                   Lost connectivity       Driver/ops updates can
                                                  queue/retry; customer
                                                  sees last known status.

  EC-22                   WhatsApp unavailable    Use SMS/email fallback
                                                  for critical
                                                  communications.

  EC-23                   Customer books for      Capture traveller
                          parents                 consent/contact and
                                                  booker relationship.

  EC-24                   Emergency contact       Expose configured
                          needed                  support escalation path.

  EC-25                   Cancellation before     Apply approved policy;
                          fulfilment              release pending supplier
                                                  holds.

  EC-26                   Cancellation after      Apply component-level
                          partial fulfilment      refund/penalty rules.

  EC-27                   Tax/rate change         Quote is versioned;
                                                  never silently mutate
                                                  confirmed quote.

  EC-28                   Discount invalid        Reject with clear
                                                  reason; retain original
                                                  quote.

  EC-29                   Stale temple data       Show last-verified
                                                  metadata and escalate if
                                                  operationally sensitive.

  EC-30                   Conflicting provider    Use source hierarchy and
                          data                    operations override; log
                                                  conflict.

  EC-31                   AI output conflicts     Rules engine wins; AI
                          with rules              explains constraint.

  EC-32                   AI cannot parse user    Ask clarification or
                          request                 route to structured
                                                  planner.

  EC-33                   Prompt injection /      Treat external text as
                          malicious input         untrusted; never expose
                                                  secrets or bypass tool
                                                  boundaries.

  EC-34                   Unauthorised operations RBAC blocks action and
                          action                  records security event.

  EC-35                   Concurrent itinerary    Use
                          edits                   versioning/concurrency
                                                  control; preserve
                                                  history.

  EC-36                   Failed replan           Retain last feasible
                                                  itinerary and create
                                                  operations alert.

  EC-37                   Trip partially          Passport reflects
                          completed               validated events;
                                                  remaining plan remains
                                                  actionable.

  EC-38                   Pilot/manual booking    Allow operations-created
                                                  bookings with
                                                  source/channel metadata
                                                  and full audit trail.
  ------------------------------------------------------------------------

# 7. Canonical State Machines

D-04 remains open. The following is the recommended baseline for
approval; engineering should not hard-code irreversible transitions
until Product Owner approval.

  ------------------------------------------------------------------------------------
  **Object**              **States**                           **Rules**
  ----------------------- ------------------------------------ -----------------------
  PlanningSession         OPEN → COLLECTING → READY_FOR_PLAN → Conversation state
                          PLAN_GENERATED → EXPIRED/CANCELLED   only; no booking
                                                               authority.

  Itinerary               DRAFT → VALIDATED → PROPOSED →       Every modification
                          ACCEPTED → MODIFIED → OPS_ADJUSTED → creates a version.
                          LIVE → COMPLETED/ABANDONED           

  Quote                   DRAFT → CALCULATED → PRESENTED →     Same inputs + same
                          ACCEPTED → EXPIRED/CANCELLED         rate-card version must
                                                               reproduce the same
                                                               result.

  Booking                 REQUESTED → FULFILMENT_PENDING →     CONFIRMED only when
                          CONFIRMED → IN_PROGRESS → COMPLETED  required fulfilment
                          / CANCELLED                          components are
                                                               confirmed.

  Payment                 NOT_REQUIRED → PENDING →             Independent from
                          AUTHORIZED/SUCCESS →                 booking fulfilment.
                          FAILED/REFUNDED/PARTIALLY_REFUNDED   

  Fulfilment              PENDING → VEHICLE_CONFIRMED →        Actual required
                          HOTEL_CONFIRMED → SERVICE_CONFIRMED  components depend on
                          → READY                              package.

  Trip                    SCHEDULED → DRIVER_ASSIGNED →        Operations owns
                          PICKUP_READY → STARTED → IN_PROGRESS operational
                          → COMPLETED / INCIDENT / CANCELLED   transitions.

  TempleVisit             PLANNED → ARRIVED → VISITING →       Completion must have
                          COMPLETED / SKIPPED                  validated event
                                                               authority.

  Passport                0/9 → n/9 → 9/9 → CERTIFIED          Completion events only
                                                               from validated sources.
  ------------------------------------------------------------------------------------

# 8. AI Planner Functional Contract

## 8.1 TripRequest

The conversational layer must transform user messages into a validated
structured request before itinerary generation.

  ---------------------------------------------------------------------------------
  **Field**           **Type**          **Requirement**   **Purpose**
  ------------------- ----------------- ----------------- -------------------------
  origin              string            Required when     Pickup/arrival origin
                                        known             

  travelDate          date              Required for      Trip date
                                        date-specific     
                                        planning          

  days                enum:             Required or       Planning horizon
                      1,2,3+,flexible   inferred          

  travellers          array             Required          Age band, mobility, food,
                                                          role

  purpose             enum/string       Required          All 9, pariharam,
                                                          peaceful darshan, family,
                                                          etc.

  vehiclePreference   enum/string       Optional          Comfort/capacity/budget

  hotelRequired       boolean           Optional          Whether overnight stay is
                                                          needed

  hotelPreference     object            Optional          Budget/location/comfort

  poojaRequests       array             Optional          Temple/service intent

  foodPreference      object            Optional          Vegetarian/Satvik/etc.

  constraints         array             Optional          Arrival/departure,
                                                          walking, breaks

  booker              object            Required before   Booker/traveller
                                        booking           relationship
  ---------------------------------------------------------------------------------

## 8.2 DecisionRecord

-   Input snapshot and normalized values.

-   Candidate plans considered.

-   Feasibility results and failed constraints.

-   Recommendation score by configurable factor.

-   Selected itinerary template and version.

-   Price/rate-card version used for quote.

-   Verified data sources used.

-   Warnings and unresolved uncertainties.

-   Human/operations overrides.

-   Timestamp and correlation ID.

## 8.3 LLM restrictions

-   LLM cannot directly create payment, booking or fulfilment
    confirmations.

-   LLM cannot invent current temple hours, service availability,
    prices, hotel inventory or traffic.

-   LLM cannot override deterministic feasibility.

-   LLM output must be schema-validated before downstream processing.

-   Tool access, if introduced later, must be allow-listed and separated
    from transactional authority.

# 9. Itinerary Engine

## 9.1 MVP templates

  -----------------------------------------------------------------------------
  **Template**      **Use case**            **MVP status**    **Rules**
  ----------------- ----------------------- ----------------- -----------------
  1D-FAST           Time-constrained        P0                Only offered if
                    travellers                                all feasibility
                                                              constraints pass.

  1D-BALANCED       Default one-day option  P0                Balances travel
                                                              efficiency and
                                                              reasonable temple
                                                              dwell time.

  1D-RELAXED        One-day with additional P0 when feasible  May be infeasible
                    buffer                                    depending on
                                                              origin/time.

  2D/1N-COMFORT     Senior/family/default   P0                Recommended when
                    comfort option                            1D is high-strain
                                                              or infeasible.

  2D/1N-PREMIUM     Higher comfort/service  Business decision Use same
                    bundle                                    feasibility
                                                              engine; different
                                                              commercial tier.

  3D/2N             Extended circuit +      P1                Template reserved
                    add-ons                                   for later
                                                              release.
  -----------------------------------------------------------------------------

## 9.2 Feasibility constraints

-   Temple/service operating windows.

-   Travel time between stops plus configurable safety/buffer factor.

-   Required arrival/departure constraints.

-   Minimum visit duration per temple/service.

-   Meal and rest breaks.

-   Senior-friendly break/walking constraints.

-   Vehicle capacity and availability.

-   Hotel check-in/check-out constraints for overnight plans.

-   Configured service/pooja windows.

-   Operations-defined blackout or exception periods.

## 9.3 Recommendation scoring

Use configurable weights rather than hard-coded product logic. Initial
illustrative factors from the Decision Engine specification:

  -----------------------------------------------------------------------
  **Factor**                          **Illustrative weight**
  ----------------------------------- -----------------------------------
  Feasibility gate                    Mandatory

  Purpose fit                         25%

  Comfort                             20%

  Travel efficiency                   20%

  Budget                              15%

  Operational reliability             10%

  Preference fit                      10%
  -----------------------------------------------------------------------

# 10. Quote & Commercial Engine

The audit identified the absence of explicit Quote/RateCard/Package
entities as a material gap. These entities should be introduced before
production pricing is implemented.

  -----------------------------------------------------------------------
  **Entity**              **Purpose**             **Key fields**
  ----------------------- ----------------------- -----------------------
  Package                 Commercial product      code, name, template,
                          definition              tier, inclusions,
                                                  exclusions, active
                                                  dates

  RateCard                Versioned pricing       vehicle/hotel/service
                          source                  rates, effective dates,
                                                  source, margin rules

  Quote                   Immutable commercial    tripId,
                          snapshot                rateCardVersion,
                                                  components, taxes,
                                                  discounts, total,
                                                  expiry

  QuoteLine               Line-item calculation   type, quantity, unit
                                                  price, tax, margin
                                                  metadata

  PriceRule               Deterministic           date, zone, demand,
                          adjustment              traveller, add-on rules
  -----------------------------------------------------------------------

## 10.1 Quote rules

-   Same inputs + same RateCard version = reproducible quote.

-   A confirmed quote must not silently change because an upstream rate
    changes.

-   Every quote stores the calculation inputs and rate-card version.

-   Tax treatment remains configurable pending D-07.

-   Margins remain configurable pending D-08.

-   AI may explain the quote but cannot calculate an authoritative total
    independently.

# 11. Booking, Payment & Fulfilment

The audit\'s most important operational correction is to separate
payment status from fulfilment status.

  ------------------------------------------------------------------------
  **Scenario**            **Customer-visible      **Operations action**
                          status**                
  ----------------------- ----------------------- ------------------------
  Payment pending         Payment Pending         Await payment / expiry
                                                  policy

  Payment success,        Payment Successful ·    Confirm
  fulfilment pending      Confirmation Pending    hotel/vehicle/services

  All required fulfilment Confirmed               Send confirmation
  confirmed                                       

  Payment failed          Payment Failed          Retry or cancel per
                                                  policy

  Partial supplier        Confirmation Pending /  Offer alternative or
  failure                 Action Required         refund component
  ------------------------------------------------------------------------

## 11.1 Confirmation definition

Recommended: "Confirmed" means all mandatory fulfilment components
required by the selected package are confirmed and the payment state
satisfies the approved commercial policy.

## 11.2 Payment requirements

-   Use an India-ready payment gateway selected under D-11.

-   Use provider webhook verification and idempotency.

-   Do not create false booking confirmation from client-side payment
    success alone.

-   Maintain payment transaction ID, gateway response, amount, currency
    and timestamps.

-   Refunds and partial refunds must be represented as explicit state
    transitions.

# 12. Operations Platform

  -----------------------------------------------------------------------
  **Screen / capability**             **P0 behaviour**
  ----------------------------------- -----------------------------------
  Today's Trips                       Filter by date/status; show
                                      customer, traveller count, vehicle,
                                      driver, route and status.

  Trip Detail                         Timeline, itinerary versions,
                                      services, payment/fulfilment,
                                      contacts, incidents and audit
                                      events.

  Assignment                          Assign/change vehicle and driver
                                      with reason and audit event.

  Service Confirmation                Hotel/pooja/other service
                                      confirmation status and supplier
                                      reference.

  Trip Event                          Create pickup, arrival, temple
                                      completion, meal/rest, delay and
                                      issue events.

  Itinerary Change                    Modify plan, record reason,
                                      preserve previous version, notify
                                      customer.

  Communication                       Contact customer/driver through
                                      configured channels; log action.

  Finance status                      Payment, refund and cancellation
                                      states visible separately from
                                      fulfilment.
  -----------------------------------------------------------------------

## 12.1 Manual concierge mode

-   From week 1, operations must be able to create a trip/bookings
    manually even when the AI planner is not used.

-   Every manual booking must carry source/channel metadata.

-   Manual bookings must use the same core Trip, Quote, Booking and
    Event models.

-   This supports the recommended 10--20 concierge trips before
    sophisticated automation.

# 13. Live Journey, Passport & Send My Parents

## 13.1 Minimal Live Journey P0

-   Current trip status.

-   Current/last completed temple.

-   Completed count (e.g., 4/9).

-   Next planned temple.

-   Last operational update timestamp.

-   Customer-visible delay or change message when applicable.

Rich GPS tracking, continuous location streaming and autonomous live
optimisation remain P1 unless separately approved.

## 13.2 Passport

-   Temple completion originates from validated operations/driver
    events.

-   Customer view shows 0/9 through 9/9.

-   A skipped temple cannot be silently treated as completed.

-   Certificate generation is downstream of 9/9 completion and remains
    P1.

## 13.3 Send My Parents

-   P0: booker identity, parent/traveller profiles, relationship,
    contact/consent, emergency contact and milestone notifications.

-   Milestones: pickup, temple completion, lunch/rest, hotel check-in,
    day completion.

-   P1: full family-facing live trip view and advanced escalation.

# 14. Data Model

  -----------------------------------------------------------------------
  **Entity**                          **Purpose**
  ----------------------------------- -----------------------------------
  User                                Identity and authentication

  Traveller                           Pilgrim profile, age band,
                                      mobility, preferences

  Trip                                Commercial/operational journey
                                      container

  Itinerary                           Versioned plan

  ItineraryLeg                        Temple/service/travel leg

  ItineraryTemplate                   Ops-approved plan template

  Temple                              Verified Navagraha master data

  TempleSchedule                      Versioned operating windows

  TempleService                       Pooja/pariharam/service offering

  Vehicle                             Vehicle type/capacity/comfort

  Driver                              Driver profile/assignment

  Hotel                               Partner hotel

  Room                                Room type/rate/availability

  Package                             Commercial package/tier

  RateCard                            Versioned pricing

  Quote                               Immutable pricing snapshot

  QuoteLine                           Quote components

  Booking                             Customer commercial booking

  Payment                             Gateway transaction state

  Fulfilment                          Supplier/service confirmation state

  TripEvent                           Operational event ledger

  Notification                        Message and delivery state

  Passport                            Nine-temple completion record

  CustomerFeedback                    CSAT/feedback

  Partner                             Hotel/service/transport supplier

  AuditLog                            Security and operational audit

  PlanningSession                     Conversation state

  DecisionRecord                      AI recommendation trace
  -----------------------------------------------------------------------

Future analytical entities: CrowdObservations, TravelPatterns,
AIRecommendations, RoutePerformance, PartnerAvailability,
DemandForecasts, and Circuit.

# 15. API Contract Baseline

  -------------------------------------------------------------------------------------
  **Method**              **Endpoint**                          **Purpose**
  ----------------------- ------------------------------------- -----------------------
  POST                    /ai/planning-sessions                 Start planner session

  POST                    /ai/planning-sessions/{id}/messages   Submit user message /
                                                                receive structured next
                                                                step

  POST                    /itineraries/generate                 Generate candidate
                                                                itinerary from
                                                                TripRequest

  POST                    /itineraries/{id}/validate            Run deterministic
                                                                feasibility

  POST                    /quotes/calculate                     Calculate reproducible
                                                                quote

  POST                    /bookings                             Create booking request

  GET                     /bookings/{id}                        Get booking status

  POST                    /payments/create                      Create payment
                                                                intent/order

  POST                    /payments/webhook                     Process verified
                                                                provider event

  GET                     /trips/{id}                           Get trip and current
                                                                state

  POST                    /trips/{id}/events                    Record validated
                                                                operational event

  POST                    /trips/{id}/replan                    Recalculate remaining
                                                                plan

  GET                     /temples                              List verified temple
                                                                records

  GET                     /temples/{id}                         Get temple detail

  GET                     /vehicles/availability                Get verified vehicle
                                                                availability

  GET                     /hotels/availability                  Get verified hotel
                                                                availability

  POST                    /notifications/send                   Send approved
                                                                notification

  GET                     /operations/trips/today               Operations trip board
  -------------------------------------------------------------------------------------

All APIs must be versioned, authenticated, observable and protected by
role-based authorisation. Sensitive mutations must emit audit events.

# 16. Roles, Permissions & Security

  -----------------------------------------------------------------------
  **Role**                            **Primary permissions**
  ----------------------------------- -----------------------------------
  Customer/Booker                     Plan, manage traveller profiles,
                                      view quotes, pay, view
                                      bookings/trips, receive
                                      notifications.

  Operations Coordinator              Create/manage trips, assign
                                      vehicle/driver, confirm services,
                                      edit itinerary, record events,
                                      communicate.

  Operations Manager                  All coordinator functions plus
                                      overrides, refunds subject to
                                      policy, configuration and
                                      reporting.

  Driver                              View assigned trip and approved
                                      customer data; record operational
                                      events if driver capability is
                                      enabled.

  Content/Admin                       Manage verified temple/content
                                      records with source and
                                      last-verified metadata.

  Finance                             View payments, refunds, invoices
                                      and financial reports.

  System Admin                        RBAC, integrations, configuration,
                                      audit access; no silent data
                                      mutation.
  -----------------------------------------------------------------------

-   Encrypt data in transit and at rest where supported.

-   Never expose payment secrets or provider credentials to client
    applications.

-   Use least-privilege access and audit sensitive actions.

-   Protect parent/child traveller contact data and emergency contacts.

-   Validate and sanitize user-provided free text before downstream use.

-   Treat LLM outputs and external content as untrusted until
    schema/authority checks pass.

# 17. Analytics & Operational Learning

  -----------------------------------------------------------------------
  **Event**                           **Minimum properties**
  ----------------------------------- -----------------------------------
  planner_started                     userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  planner_question_answered           userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  traveller_profile_completed         userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  itinerary_generated                 userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  itinerary_mode_selected             userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  quote_viewed                        userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  booking_started                     userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  booking_confirmed                   userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  payment_success                     userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  trip_started                        userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  temple_completed                    userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  itinerary_replanned                 userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  trip_completed                      userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  passport_completed                  userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version

  feedback_submitted                  userId/tripId/sessionId, timestamp,
                                      source/channel, relevant
                                      object/version
  -----------------------------------------------------------------------

## 17.1 North-star measurement

-   Primary conversion KPI from PRD: AI Planning-to-Confirmed-Booking
    Conversion Rate.

-   Add completed-trip CSAT / outcome score to prevent optimisation
    toward bookings that fail operationally.

-   Operational KPIs: on-time pickup, trip completion, temple completion
    rate, replans per trip, supplier failure rate, notification delivery
    rate.

-   Commercial KPIs: average booking value, gross margin, attach rate
    for hotel/pooja/add-ons, refund rate.

-   AI KPIs: planner completion, clarification rate, recommendation
    acceptance, infeasible-plan rate, human override rate.

# 18. Recommended 16-Week Delivery Plan

  -----------------------------------------------------------------------------------------
  **Sprint**        **Timing**        **Theme**               **Deliverables**
  ----------------- ----------------- ----------------------- -----------------------------
  S0                Week 1            Foundation              Architecture, environments,
                                                              CI/CD, auth skeleton,
                                                              observability, backlog,
                                                              concierge workflow.

  S1                Weeks 2--3        Verified data           Nine temples, schedules,
                                                              templates, vehicles, hotels,
                                                              services, source metadata.

  S2                Weeks 4--5        Decision engine         TripRequest, feasibility
                                                              solver, 1D/2D templates,
                                                              scoring, DecisionRecord.

  S3                Weeks 6--7        Operations core         Trip board, trip detail,
                                                              assignments, fulfilment,
                                                              events, audit.

  S4                Weeks 8--9        AI planner              Conversational capture,
                                                              structured planner,
                                                              recommendation/explanation,
                                                              guardrails.

  S5                Weeks 10--11      Quote/booking/payment   RateCard, Quote, booking,
                                                              payment adapter, confirmation
                                                              policy.

  S6                Weeks 12--13      Trip execution          Minimal Live Journey,
                                                              Passport events, WhatsApp
                                                              notifications, replanning
                                                              workflow.

  S7                Weeks 14--16      Pilot readiness         UAT, security, operational
                                                              rehearsal, concierge trips,
                                                              defect closure, paid pilot
                                                              launch.
  -----------------------------------------------------------------------------------------

Recommended pilot: 20--50 real pilgrimages. The first objective is a
reliable planning-to-execution loop and high-quality first-party
operational data, not scale.

# 19. Engineering Backlog Structure

The audit identifies 55 backlog stories, 47 marked MVP. Old NAV-\*
backlog IDs from the first audit draft are retired because they collide
with PRD requirement IDs. Engineering should use BL-\* IDs.

  -----------------------------------------------------------------------
  **Backlog prefix**                  **Domain**
  ----------------------------------- -----------------------------------
  BL-ID                               Identity & traveller profiles

  BL-AI                               AI planner / decision engine

  BL-IT                               Itinerary / feasibility

  BL-TEM                              Temple data/content

  BL-VEH                              Vehicle/driver

  BL-HOT                              Hotel

  BL-POO                              Pooja/services

  BL-QUOTE                            Quote/rate/package

  BL-BOOK                             Booking

  BL-PAY                              Payment

  BL-NOT                              Notifications/WhatsApp

  BL-TRIP                             Trip/live journey

  BL-PASS                             Passport

  BL-OPS                              Operations

  BL-DRV                              Driver

  BL-SEC                              Security/audit

  BL-AN                               Analytics
  -----------------------------------------------------------------------

Story template: As a \[role\], I want \[capability\], so that
\[outcome\]. Acceptance criteria must specify happy path, validation,
failure state, audit event, permissions and dependency behaviour.

# 20. MVP Acceptance Criteria

-   A new user can start planning without understanding the product
    structure.

-   AI collects only information required to materially change the
    recommendation.

-   System produces structured, feasible 1-day and 2D/1N plans from
    approved templates.

-   System distinguishes feasible and infeasible itineraries.

-   Senior-heavy groups receive comfort-adjusted recommendations.

-   Quote total is deterministic and reproducible from the same inputs
    and RateCard version.

-   Payment status and fulfilment status are independently visible.

-   Operations can assign vehicle/driver and confirm services.

-   Operations can record trip/temple events and preserve an audit
    trail.

-   Minimal Live Journey displays validated progress.

-   Passport completion reflects validated events only.

-   Send My Parents core workflow captures booker/traveller relationship
    and approved milestone notifications.

-   WhatsApp confirmation can be triggered after the approved
    confirmation condition is met.

-   Customer can view all nine temples and completion status.

-   System does not invent unavailable facts.

-   Failed external provider calls cannot create false booking
    confirmation.

-   Every itinerary change creates a new version with reason/source.

-   Sensitive operations require authorised roles.

-   Provider webhooks are idempotent and observable.

-   Manual/concierge bookings use the same core trip and audit model.

# 21. Definition of Done

-   Functional requirement mapped to a PRD ID and backlog story.

-   Acceptance criteria implemented and tested.

-   Happy path and at least the relevant failure/edge paths tested.

-   API contract documented and versioned.

-   RBAC verified.

-   Audit event emitted for sensitive mutation.

-   Analytics events implemented where applicable.

-   External provider failures handled without false state.

-   UX copy matches approved Figma specification.

-   Operational workflow tested by a real coordinator.

-   Source/last-verified metadata present for operational facts.

-   No P0 blocker remains open for pilot.

# 22. Pilot Readiness Checklist

-   10--20 concierge trips have been executed before or during final
    readiness.

-   At least one 1-day and one 2D/1N template have been validated
    operationally.

-   All nine temple master records have source and verification
    metadata.

-   Vehicle and driver assignment workflow tested.

-   Hotel and service confirmation workflow tested.

-   Payment success/failure/refund reconciliation tested.

-   WhatsApp and fallback notification paths tested.

-   Trip-event and Passport completion workflow tested.

-   Delay and replan process rehearsed manually.

-   Senior-Friendly scenario tested with an appropriate traveller
    profile.

-   Send My Parents scenario tested end-to-end.

-   Customer support escalation process documented.

-   Cancellation/refund/tax/rate-card decisions approved before
    production.

-   Privacy/security review completed.

-   Analytics dashboard captures planning, booking and trip completion
    funnel.

-   Pilot feedback/CSAT collection enabled.

# 23. Traceability & Reconciliation Rules

  -----------------------------------------------------------------------
  **Artifact**                        **Authority**
  ----------------------------------- -----------------------------------
  PRD V1.0                            Business/product requirements and
                                      scope baseline

  Master Product Audit V1.0           Critical review, gaps,
                                      contradictions, recommendations

  MVP Functional Specification V1.0   Engineering behaviour and
                                      acceptance contract

  AI Decision Engine V1.0             AI/decision logic details

  UX Blueprint V1.0                   Customer journey and UX structure

  Figma Wireframe Content V1.0        Exact UI copy and content

  Figma Design System V1.0            Component and visual-system
                                      behaviour

  Figma-ready Screen Spec V1.0        Screen-level implementation
                                      reference; add to PRD §22
                                      references
  -----------------------------------------------------------------------

When two documents conflict: explicit Product Owner decisions override
all; otherwise PRD defines product intent, this specification defines
implementation detail, and the audit identifies where a decision is
required.

# 24. PRD V1.1 Change Recommendations

  -----------------------------------------------------------------------
  **Issue**                           **Recommended V1.1 correction**
  ----------------------------------- -----------------------------------
  Passport P0 vs event recording P1   Promote minimum event recording to
                                      P0; retain certificate as P1.

  Pooja P0 vs workflow P1             Define P0 intent capture + verified
                                      service selection + status;
                                      advanced automation can remain P1.

  10-minute confirmation promise      Separate "planning/quote time" from
                                      full supplier confirmation unless
                                      operationally proven.

  Traceability vs future              Add DecisionRecord / recommendation
  AIRecommendations                   trace as MVP entity.

  Scalability vs no Circuit entity    Add Circuit/ItineraryTemplate
                                      abstraction before multi-circuit
                                      expansion.

  Reproducible quote vs missing       Add Package, RateCard, Quote and
  entities                            QuoteLine.

  Live Journey P1 vs North Star       Promote minimal status/events to
  promise                             P0; defer rich GPS.

  Payment timing unspecified          Define state-machine policy before
                                      production payment implementation.

  Fast/Balanced/Relaxed vs MVP        Keep modes as planning modes;
  duration                            templates remain 1D and 2D/1N for
                                      MVP.

  Design reference list incomplete    Add Figma-ready Screen
                                      Specification V1.0 to PRD §22.
  -----------------------------------------------------------------------

These are recommended changes, not silently applied business decisions.
D-16 remains open until the Product Owner approves the PRD V1.1 update.

# 25. Appendix --- Product Language

  -----------------------------------------------------------------------
  **Term**                            **Approved meaning**
  ----------------------------------- -----------------------------------
  Estimated                           System-generated value based on a
                                      non-confirmed source/calculation.

  Recommended                         Product/AI recommendation based on
                                      configured rules and preferences.

  Confirmed                           Required fulfilment components are
                                      confirmed and approved payment
                                      condition is satisfied.

  Senior-Friendly                     A planning mode that adjusts
                                      comfort, breaks, walking and
                                      operational uncertainty.

  Live Journey                        Customer-visible trip progress
                                      based on validated operational
                                      events; not necessarily GPS.

  Passport                            Nine-temple completion record;
                                      completion requires validated
                                      events.

  AI Planner                          Conversational interface that
                                      captures intent and presents
                                      engine-generated recommendations.

  Operations                          Human execution layer responsible
                                      for fulfilment, overrides and
                                      real-world exceptions.
  -----------------------------------------------------------------------

# 26. Final Product Decision Principle

**Build the smallest system that can reliably plan, book, execute and
learn from real Navagraha pilgrimages.**

The MVP is successful when real pilgrims can complete the journey with
fewer decisions, fewer operational surprises and a clear record of what
happened. AI sophistication should increase only after the operational
data and state model are trustworthy.

# 27. V1.1 Handoff Review --- Canonical Engineering Corrections

STATUS: CURRENT ENGINEERING HANDOFF. This section incorporates the
Claude FS V1.0 Handoff Review dated 08 October 2026. From V1.1 onward,
this Functional Specification owns the canonical D, MR and EC registers.
The Master Product Audit is frozen as an advisory record.

## 27.1 Document hierarchy

  -----------------------------------------------------------------------
  **Authority**                       **Role**
  ----------------------------------- -----------------------------------
  Product Owner decisions             Highest authority.

  PRD                                 Business requirements and product
                                      scope.

  MVP Functional Specification V1.1   Engineering behaviour, acceptance
                                      criteria and canonical D/MR/EC
                                      registers.

  AI/UX/Figma specifications          Detailed implementation references.

  Frozen Master Product Audit         Advisory review record; not the
                                      live register.
  -----------------------------------------------------------------------

## 27.2 Blocking issues B-01--B-10

  -----------------------------------------------------------------------
  **Issue**                           **V1.1 resolution**
  ----------------------------------- -----------------------------------
  B-01                                MR-01..MR-56 are now individually
                                      registered below; no range-only
                                      coverage.

  B-02                                EC-01..EC-38 audit cases are
                                      retained and EC-39..EC-56 are
                                      FS-derived additions.

  B-03                                Canonical backlog prefixes and
                                      crosswalk are defined below.

  B-04                                Numeric MVP NFRs are added in §31.

  B-05                                Ops booking, confirmation,
                                      change/cancel, refund, OTP/session
                                      and internal notification APIs are
                                      added in §32.

  B-06                                Payment and fulfilment are parallel
                                      gates; canonical state model is
                                      replaced in §33.

  B-07                                Template × Mode × Tier is
                                      canonical; Senior-Friendly is a
                                      mode overlay.

  B-08                                Circuit becomes an MVP entity in
                                      §35.

  B-09                                Traveller is restored; PRD role
                                      vocabulary is preserved subject to
                                      D-18.

  B-10                                Engine-assisted replanning remains
                                      P1; P0 is manual operations edit +
                                      version + notification.
  -----------------------------------------------------------------------

## 27.3 MVP priority corrections

-   NAV-LIVE-003 = P0 operations/coordinator event recording.

-   NAV-LIVE-004 and NAV-IT-006 engine-assisted replanning = P1.

-   Minimal Live Journey = P0.

-   Send My Parents core = P0; full family live view = P1.

-   Driver signed-link page = P1 unless D-15 explicitly promotes it;
    coordinator capture is the P0 fallback.

# 28. Canonical Missing-Requirement Register --- MR-01..MR-56

  ----------------------------------------------------------------------------------
  **ID**                  **Requirement**                    **Priority /
                                                             treatment**
  ----------------------- ---------------------------------- -----------------------
  MR-01                   OTP sign-in + session merge        P0

  MR-02                   Booker/traveller/lead roles        P0

  MR-03                   Pre-trip checklist T-48h/T-12h     P0

  MR-04                   Change & cancel requests           P0

  MR-05                   Post-trip feedback                 P0

  MR-06                   Family status link                 P1

  MR-07                   TripRequest schema                 P0

  MR-08                   Chip-only planner fallback         P0

  MR-09                   AI eval set & pass bar             P0

  MR-10                   AI language scope                  P0

  MR-11                   LLM cost/latency budget            P0

  MR-12                   Booking & fulfilment state         P0
                          machines                           

  MR-13                   Quote validity/price lock          P0

  MR-14                   Lead time & cut-offs               P0

  MR-15                   Daily capacity limits              P0

  MR-16                   Group size & child-age rules       P0

  MR-17                   Deposit & balance                  P0 / D-06 policy

  MR-18                   Cancellation/refund tiers          P0 / D-06 policy

  MR-19                   Webhook reconciliation &           P0
                          idempotency                        

  MR-20                   GST invoice/tax                    P0 / D-07 policy

  MR-21                   International cards                P1 / D-11

  MR-22                   Fulfilment tasks with SLAs         P0

  MR-23                   Incident model                     P0

  MR-24                   On-call cover                      P0

  MR-25                   Day-before manifests               P0

  MR-26                   Driver onboarding                  P0

  MR-27                   Tamil driver UI                    P1

  MR-28                   Driver payouts                     P1

  MR-29                   Thirunallar (Puducherry) entry     P0
                          rules                              

  MR-30                   Hotel confirm workflow             P0
                          SLA/fallback                       

  MR-31                   Room-mix rules                     P0

  MR-32                   Pooja catalogue                    P0

  MR-33                   On-site temple fee disclosure      P0

  MR-34                   Notification matrix                P0

  MR-35                   WhatsApp opt-in & fallback         P0

  MR-36                   RBAC                               P0

  MR-37                   PII encryption/retention/masking   P0

  MR-38                   Rate limiting & prompt-injection   P0
                          defence                            

  MR-39                   Event taxonomy/funnel              P0

  MR-40                   Planned-vs-actual capture          P0

  MR-41                   Privacy/consent (DPDP)             P0

  MR-42                   Operator registration & permits    P0

  MR-43                   Belief-vs-fact & AI disclaimers    P0

  MR-44                   Liability/insurance                P0

  MR-45                   Support SLAs                       P0

  MR-46                   Shared WhatsApp inbox              P1

  MR-47                   Temple master with source metadata P0

  MR-48                   Travel-time matrix                 P0

  MR-49                   Festival calendar                  P0

  MR-50                   Rate/package/tax/coupon admin      P0

  MR-51                   Content review workflow            P0

  MR-52                   Audit log viewer                   P0

  MR-53                   Circuit entity                     P0

  MR-54                   Quote/QuoteLine/RateCard/Package   P0

  MR-55                   DecisionRecord                     P0

  MR-56                   Numeric NFRs                       P0
  ----------------------------------------------------------------------------------

# 29. Canonical Edge-Case Register --- EC-01..EC-56

  -----------------------------------------------------------------------
  **ID**                  **Scenario**            **Handling**
  ----------------------- ----------------------- -----------------------
  EC-01                   Temple closed           Canonical state/event
                                                  handling + UAT

  EC-02                   Late at pickup          Canonical state/event
                                                  handling + UAT

  EC-03                   Early arrival           Canonical state/event
                                                  handling + UAT

  EC-04                   Train/flight delayed    Canonical state/event
                                                  handling + UAT

  EC-05                   Vehicle breakdown       P0 pilot playbook

  EC-06                   Driver unavailable      Canonical state/event
                                                  handling + UAT

  EC-07                   Driver phone dead       Canonical state/event
                                                  handling + UAT

  EC-08                   Hotel can\'t honour     Canonical state/event
                                                  handling + UAT

  EC-09                   Hotel confirmation      Canonical state/event
                          overdue                 handling + UAT

  EC-10                   Pooja unavailable       Canonical state/event
                                                  handling + UAT

  EC-11                   Skip temple             Canonical state/event
                                                  handling + UAT

  EC-12                   Add temple              Canonical state/event
                                                  handling + UAT

  EC-13                   Senior tired/unwell     P0 pilot playbook

  EC-14                   Medical emergency       P0 pilot playbook

  EC-15                   Traffic/road closure    Canonical state/event
                                                  handling + UAT

  EC-16                   Long queue              Canonical state/event
                                                  handling + UAT

  EC-17                   9/9 not feasible today  P0 pilot playbook

  EC-18                   Extend trip             Canonical state/event
                                                  handling + UAT

  EC-19                   Change hotel pre-trip   Canonical state/event
                                                  handling + UAT

  EC-20                   Change date             Canonical state/event
                                                  handling + UAT

  EC-21                   Cancel                  Canonical state/event
                                                  handling + UAT

  EC-22                   Payment OK, booking     Canonical state/event
                          failed                  handling + UAT

  EC-23                   Payment fails           Canonical state/event
                                                  handling + UAT

  EC-24                   Duplicate payment       Canonical state/event
                                                  handling + UAT

  EC-25                   UPI pending             Canonical state/event
                                                  handling + UAT

  EC-26                   Price changed before    Canonical state/event
                          payment                 handling + UAT

  EC-27                   Traveller drops out     Canonical state/event
                                                  handling + UAT

  EC-28                   Extra travellers show   Canonical state/event
                          up                      handling + UAT

  EC-29                   Rain/cyclone            P0 pilot playbook

  EC-30                   LLM outage              Canonical state/event
                                                  handling + UAT

  EC-31                   Maps outage             Canonical state/event
                                                  handling + UAT

  EC-32                   WhatsApp failure        Canonical state/event
                                                  handling + UAT

  EC-33                   Medical/astro claim     Canonical state/event
                                                  handling + UAT

  EC-34                   Prompt injection        Canonical state/event
                                                  handling + UAT

  EC-35                   Parents unreachable     Canonical state/event
                                                  handling + UAT

  EC-36                   Tracking without        Canonical state/event
                          consent                 handling + UAT

  EC-37                   False temple completion Canonical state/event
                                                  handling + UAT

  EC-38                   Special day             Canonical state/event
                                                  handling + UAT

  EC-39                   Incomplete planner      Canonical state/event
                          input                   handling + UAT

  EC-40                   1-day infeasible at     Canonical state/event
                          planning                handling + UAT

  EC-41                   Vehicle unavailable at  Canonical state/event
                          quote                   handling + UAT

  EC-42                   Provider timeout        Canonical state/event
                                                  handling + UAT

  EC-43                   Duplicate webhook       Canonical state/event
                                                  handling + UAT

  EC-44                   Unsupported ritual      Canonical state/event
                                                  handling + UAT

  EC-45                   Self-reported           Canonical state/event
                          completion              handling + UAT

  EC-46                   Lost connectivity       Canonical state/event
                                                  handling + UAT

  EC-47                   Cancel after partial    Canonical state/event
                          fulfilment              handling + UAT

  EC-48                   Invalid discount        Canonical state/event
                                                  handling + UAT

  EC-49                   Stale temple data       Canonical state/event
                                                  handling + UAT

  EC-50                   Conflicting provider    Canonical state/event
                          data                    handling + UAT

  EC-51                   AI vs rules             Canonical state/event
                                                  handling + UAT

  EC-52                   AI can\'t parse         Canonical state/event
                                                  handling + UAT

  EC-53                   Unauthorised ops action Canonical state/event
                                                  handling + UAT

  EC-54                   Concurrent edits        Canonical state/event
                                                  handling + UAT

  EC-55                   Replan fails            Canonical state/event
                                                  handling + UAT

  EC-56                   Partially completed     Canonical state/event
                          trip                    handling + UAT
  -----------------------------------------------------------------------

# 30. Canonical Backlog Crosswalk

  -----------------------------------------------------------------------
  **Legacy / audit**                  **Canonical FS ID**
  ----------------------------------- -----------------------------------
  DATA-001/002                        TEM-001/002

  CONT-001/002                        TEM-003/004

  ENG-001..007                        IT-001..007

  DATA-003                            IT-008

  DATA-004                            IT-009

  BOOK-001/002                        ID-001/002

  OPS-003                             VEH-001 / HOT-001 / POO-001

  TRIP-003/004                        PASS-001/002

  NOTIF-001                           NOT-001

  New                                 TEM-005 Circuit; IT-010
                                      capacity/lead time; ID-003 consent;
                                      BOOK-007 change requests; AN-002
                                      planned-vs-actual; SEC-002 NFR
                                      verification
  -----------------------------------------------------------------------

Old moved IDs are retired. The canonical backlog contains 63 stories
after V1.1 additions; every story must carry PRD/MR/EC references.

# 31. Non-Functional Requirements --- Numeric MVP Targets

  -----------------------------------------------------------------------
  **ID**                              **Target**
  ----------------------------------- -----------------------------------
  NFR-01                              API availability ≥99.5% monthly
                                      during pilot, excluding planned
                                      maintenance.

  NFR-02                              Non-provider CRUD/read API p95 ≤500
                                      ms.

  NFR-03                              Planner p95 ≤8 s; fallback/timeout
                                      at 15 s.

  NFR-04                              Quote calculation p95 ≤1 s
                                      excluding provider checks.

  NFR-05                              Booking mutation p95 ≤2 s to accept
                                      request; fulfilment may be
                                      asynchronous.

  NFR-06                              Valid webhook acknowledgement ≤2 s;
                                      asynchronous processing allowed.

  NFR-07                              Notification enqueue p95 ≤2 s.

  NFR-08                              Application 5xx \<1% on supported
                                      non-provider traffic during pilot.

  NFR-09                              Duplicate provider/payment events
                                      cause zero duplicate
                                      financial/booking effects.

  NFR-10                              100% sensitive mutations audited.

  NFR-11                              RPO ≤15 min; RTO ≤4 h for pilot.

  NFR-12                              ≥99% schema-valid AI planner
                                      responses in release evaluation
                                      set.

  NFR-13                              0 critical AI cases inventing
                                      confirmation, price, availability
                                      or completion.

  NFR-14                              100% protected PII endpoints
                                      require authentication +
                                      authorisation.

  NFR-15                              Public planner default rate limit
                                      target 60 requests/min/IP,
                                      configurable.

  NFR-16                              100% booking/payment/fulfilment
                                      mutations carry correlation IDs.

  NFR-17                              100% quote regression cases
                                      reproduce the same total from
                                      identical inputs + RateCard
                                      version.

  NFR-18                              0 customer self-service actions can
                                      mark temple completion.
  -----------------------------------------------------------------------

# 32. V1.1 API Contract Additions

  -------------------------------------------------------------------------------
  **Method**              **Endpoint**                    **Purpose**
  ----------------------- ------------------------------- -----------------------
  POST                    /auth/otp/request               Request OTP

  POST                    /auth/otp/verify                Verify OTP + session
                                                          merge

  POST                    /leads                          Create/update planning
                                                          lead

  POST                    /bookings/manual                Operations-created
                                                          booking

  POST                    /bookings/{id}/confirm          Provider/operations
                                                          confirmation

  POST                    /bookings/{id}/change-request   Change request

  POST                    /bookings/{id}/cancel-request   Cancellation request

  POST                    /payments/{id}/refund           Authorised
                                                          refund/partial refund

  POST                    /fulfilments/{id}/confirm       Confirm service
                                                          component

  POST                    /fulfilments/{id}/tasks         Fulfilment task/SLA

  POST                    /trips/{id}/incidents           Create incident

  POST                    /trips/{id}/manifest            Generate day-before
                                                          manifest

  GET                     /operations/trips/{id}/events   Event ledger

  POST                    /notifications/internal         Internal notification
                                                          orchestration

  POST                    /whatsapp/opt-in                Record consent

  POST                    /whatsapp/webhook               Provider event callback

  POST                    /trips/{id}/change-request      Trip change request

  POST                    /trips/{id}/cancel-request      Trip cancellation
                                                          request

  GET                     /quotes/{id}                    Retrieve immutable
                                                          quote

  POST                    /quotes/{id}/lock               Accept/lock quote
  -------------------------------------------------------------------------------

Notifications are server-side/event-driven; the customer application
must not call an unrestricted send endpoint. Provider callbacks must be
authenticated and idempotent.

# 33. Canonical State Machines --- V1.1

  -----------------------------------------------------------------------
  **Object**                          **Canonical states**
  ----------------------------------- -----------------------------------
  Lead                                NEW → QUALIFIED → PLANNING → QUOTED
                                      → CONVERTED / LOST

  PlanningSession                     OPEN → COLLECTING → READY →
                                      PLAN_GENERATED → EXPIRED /
                                      CANCELLED

  Itinerary                           DRAFT → VALIDATED → PROPOSED →
                                      ACCEPTED → OPS_ADJUSTED → LIVE →
                                      COMPLETED / ABANDONED

  Quote                               DRAFT → CALCULATED → PRESENTED →
                                      ACCEPTED/LOCKED → EXPIRED/CANCELLED

  Payment                             NOT_REQUIRED → PENDING → SUCCESS /
                                      FAILED → REFUNDED /
                                      PARTIALLY_REFUNDED

  Fulfilment                          PENDING → PARTIAL →
                                      ALL_REQUIRED_CONFIRMED → RELEASED /
                                      FAILED / CANCELLED

  Booking                             REQUESTED → PENDING_CONFIRMATION →
                                      CONFIRMED → IN_PROGRESS → COMPLETED
                                      / CANCELLED

  Trip                                SCHEDULED → DRIVER_ASSIGNED →
                                      PICKUP_READY → STARTED →
                                      IN_PROGRESS → COMPLETED / INCIDENT
                                      / CANCELLED

  TempleVisit                         PLANNED → ARRIVED → VISITING →
                                      COMPLETED / SKIPPED

  Passport                            0/9 → N/9 → 9/9 → CERTIFIED

  ChangeRequest                       REQUESTED → REVIEWING →
                                      APPROVED/REJECTED → APPLIED

  Cancellation                        REQUESTED → REVIEWING →
                                      APPROVED/REJECTED → REFUND_PENDING
                                      → REFUNDED
  -----------------------------------------------------------------------

Booking CONFIRMED is a parallel gate: approved payment condition from
D-06 AND all mandatory fulfilment components confirmed. Payment and
fulfilment are not sequential states of one another.

# 34. Canonical Template × Mode × Tier

  -----------------------------------------------------------------------
  **Dimension**           **Examples**            **Meaning**
  ----------------------- ----------------------- -----------------------
  Template                1D; 2D/1N; future 3D/2N Operational itinerary
                                                  structure.

  Mode                    Fast; Balanced;         Planning
                          Relaxed;                preference/comfort
                          Senior-Friendly overlay behaviour.

  Tier                    Essential; Comfort;     Commercial inclusion
                          Premium                 level; pricing remains
                                                  D-02/D-08 dependent.

  Add-on                  Pooja; pickup;          Optional service
                          sightseeing;            component.
                          coordinator             
  -----------------------------------------------------------------------

Senior-Friendly is a mode/constraint overlay, not a commercial tier.

# 35. Circuit Entity --- MVP

  -----------------------------------------------------------------------
  **Field**                           **Purpose**
  ----------------------------------- -----------------------------------
  circuitId                           Unique circuit

  name                                Display name

  region                              Operational geography

  templeIds                           Eligible temple set

  templates                           Linked itinerary templates

  activeFrom/activeTo                 Validity

  status                              Draft/Active/Retired

  sourceVersion                       Master-data version
  -----------------------------------------------------------------------

Navagraha is the first Circuit record. This permits future Kumbakonam,
Chola, Tamil Nadu and South India circuits without schema redesign.

# 36. Roles --- D-18 Controlled Vocabulary

  -----------------------------------------------------------------------
  **Role**                            **Authority**
  ----------------------------------- -----------------------------------
  Booker                              Creates/manages booking; may differ
                                      from Traveller.

  Traveller                           Person undertaking pilgrimage;
                                      retained as domain entity.

  Operations Coordinator              Day-to-day fulfilment and event
                                      capture.

  Operations Manager                  Overrides, approvals and
                                      escalation.

  Driver                              Trip execution; event capture if
                                      enabled.

  Content Administrator               Verified temple/content
                                      maintenance.

  Finance                             Payment/refund/invoice visibility.

  System Administrator                Technical configuration/security.
  -----------------------------------------------------------------------

D-18 remains open only for final naming alignment in PRD §12 and UI/RBAC
labels.

# 37. Driver Experience --- D-15

-   P0 fallback: Operations Coordinator records driver/temple events
    from phone/WhatsApp.

-   P1 preferred: secure signed-link driver page with assigned trip,
    next stop, event buttons and incident reporting.

-   Driver event timestamps are server-recorded and auditable.

-   Driver cannot complete a temple outside an assigned active trip.

-   If D-15 explicitly promotes the signed-link page, it becomes a
    controlled P0 scope addition.

# 38. Mandatory Pilot Playbooks

## EC-05 Vehicle breakdown

-   Record incident

-   Notify customer

-   Assign replacement

-   Manually re-check remaining feasibility

-   Record financial/refund impact

## EC-13 Senior tired/unwell

-   Pause

-   Escalate appropriately

-   Do not diagnose

-   Operations decides skip/extend/replan

-   Record acknowledgement

## EC-14 Medical emergency

-   Emergency escalation

-   Contact authorised emergency contact

-   Suspend itinerary

-   Record incident

-   Resume only after operational clearance

## EC-17 9/9 not feasible today

-   Run feasibility

-   Explain honestly

-   Offer remaining/extension/hotel option

-   Version itinerary

-   Notify customer

## EC-29 Rain/cyclone

-   Use verified source

-   Assess operational safety

-   Pause/cancel if needed

-   Notify customer

-   Apply approved refund policy

# 39. V1.1 Acceptance Additions

-   OTP/session merge prevents duplicate customer records.

-   T-48h/T-12h checklist notifications are configurable and auditable.

-   AI evaluation set and pass bar exist before pilot.

-   Accepted quotes are price-locked according to approved validity
    policy.

-   Duplicate webhooks create zero duplicate effects.

-   Fulfilment tasks expose owner, SLA, status and escalation.

-   DPDP/privacy consent and retention controls are documented before
    production PII.

-   Operator registration/permit and liability/insurance readiness are
    pilot gates.

-   Circuit exists before multi-circuit expansion.

-   Quote/RateCard/Package are used by production pricing.

-   DecisionRecord is persisted for AI recommendations.

-   NFR results are attached to release readiness.

-   EC-39..56 are included in scripted/automated UAT as appropriate.

# 40. Version Control & Ownership

  -----------------------------------------------------------------------
  **Version**                         **Status**
  ----------------------------------- -----------------------------------
  PRD V1.0                            Product requirement baseline

  Master Product Audit V1.0           FROZEN advisory record

  MVP Functional Specification V1.0   Superseded after handoff review

  MVP Functional Specification V1.1   CURRENT engineering handoff; owns
                                      D/MR/EC registers
  -----------------------------------------------------------------------

Next controlled artifact: PRD V1.1 after Product Owner decisions are
resolved. Engineering must not silently infer unresolved business
policy.
